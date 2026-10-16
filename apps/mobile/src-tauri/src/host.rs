// The app open to other devices, as the computer's server is: an HTTP listener on all addresses (the
// computer's port, 4580, or the one taken before when that was busy). Each request goes to the page,
// where the server's code answers it (src/host.ts): its head through a channel, its body read here as
// it comes and pulled by the page through the `media` scheme (`/.host/<id>`: never waiting long — the
// WebView asks the scheme one request at a time, the app's own media too), the answer's body sent
// back in parts. What the
// computer's server sends from the disk is sent from here: a file the page names (media, recordings —
// ranges and all), or one of the web app's own files built into the app.
use std::collections::HashMap;
use std::collections::VecDeque;
use std::convert::Infallible;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::task::{Context, Poll};
use std::time::Duration;

use base64::Engine;
use bytes::Bytes;
use http_body_util::combinators::BoxBody;
use http_body_util::{BodyExt, Empty, Full};
use hyper::body::{Frame, Incoming};
use hyper::header::{self, HeaderName, HeaderValue};
use hyper::{Request, Response, StatusCode};
use tauri::ipc::Channel;
use tauri::{AppHandle, Runtime};
use tokio::sync::{mpsc, oneshot, Notify, Semaphore};

use crate::files;

type Body = BoxBody<Bytes, io::Error>;

/** The port the computer's server listens on by default; then the next few, then any. */
const PORT: u16 = 4580;
const PORTS_TRIED: u16 = 20;
/** Where the port taken is kept (a later start takes it again). */
const PORT_FILE: &str = "host.json";
/** Connections served at once. */
const CONNECTIONS: usize = 64;
/** The most of a request's body handed to the page at a time. */
const PULL: usize = 1 << 20;
/** The most of a request's body read ahead of the page. */
const AHEAD: usize = 4 << 20;
/** How long a pull waits for its body to come before it answers with nothing yet. */
const PULL_WAIT: Duration = Duration::from_millis(100);
/** A file sent in parts of this size. */
const PART: usize = 256 << 10;
/** Parts of an answer's body held before the page waits. */
const HELD: usize = 4;

/** A request the page answers. */
struct Pending {
    answer: Option<oneshot::Sender<Response<Body>>>,
    /** Its body, read as it comes, pulled by the page. */
    body: Option<Arc<Inflow>>,
    /** The answer's body, while the page sends it. */
    sink: Option<mpsc::Sender<Result<Bytes, io::Error>>>,
    range: Option<String>,
    head: bool,
}

impl Drop for Pending {
    fn drop(&mut self) {
        if let Some(body) = &self.body {
            body.close();
        }
    }
}

/** A request's body read ahead of the page (at most AHEAD), until it ends, fails or is let go. */
#[derive(Default)]
struct Inflow {
    state: Mutex<InState>,
    came: Condvar,
    room: Notify,
}

#[derive(Default)]
struct InState {
    parts: VecDeque<Bytes>,
    held: usize,
    end: bool,
    failed: bool,
    closed: bool,
}

impl Inflow {
    fn start(body: Incoming) -> Arc<Self> {
        let inflow = Arc::new(Self::default());
        let reading = inflow.clone();
        tauri::async_runtime::spawn(async move {
            let mut body = body;
            loop {
                let (closed, full) = {
                    let state = reading.state.lock().unwrap();
                    (state.closed, state.held >= AHEAD)
                };
                if closed {
                    return;
                }
                if full {
                    reading.room.notified().await;
                    continue;
                }
                let frame = body.frame().await;
                let done = {
                    let mut state = reading.state.lock().unwrap();
                    match frame {
                        None => state.end = true,
                        Some(Err(_)) => state.failed = true,
                        Some(Ok(frame)) => {
                            if let Ok(data) = frame.into_data() {
                                state.held += data.len();
                                state.parts.push_back(data);
                            }
                        }
                    }
                    state.end || state.failed
                };
                reading.came.notify_all();
                if done {
                    return;
                }
            }
        });
        inflow
    }

    /** What came since (up to PULL), waiting a moment for some: the bytes, whether it is all; an
     *  error when it broke off. */
    fn take(&self) -> Result<(Vec<u8>, bool), ()> {
        let state = self.state.lock().unwrap();
        let (mut state, _) = self
            .came
            .wait_timeout_while(state, PULL_WAIT, |s| {
                s.parts.is_empty() && !s.end && !s.failed
            })
            .unwrap();
        let mut out = Vec::new();
        while out.len() < PULL {
            let Some(part) = state.parts.pop_front() else {
                break;
            };
            state.held -= part.len();
            out.extend_from_slice(&part);
        }
        let (end, failed) = (state.end && state.parts.is_empty(), state.failed);
        drop(state);
        self.room.notify_one();
        if failed && out.is_empty() {
            return Err(());
        }
        Ok((out, end))
    }

    fn close(&self) {
        self.state.lock().unwrap().closed = true;
        self.room.notify_one();
    }
}

struct Shared {
    page: Mutex<Channel<serde_json::Value>>,
    pending: Mutex<HashMap<u64, Pending>>,
    next: AtomicU64,
    port: u16,
}

/** The listener, once started. */
#[derive(Default)]
pub struct Host(Mutex<Option<Arc<Shared>>>);

impl Host {
    fn shared(&self) -> Result<Arc<Shared>, String> {
        self.0
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| "not listening".into())
    }
}

/** A body of parts sent through a channel. */
struct Parts(mpsc::Receiver<Result<Bytes, io::Error>>);

impl hyper::body::Body for Parts {
    type Data = Bytes;
    type Error = io::Error;
    fn poll_frame(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, io::Error>>> {
        self.0
            .poll_recv(cx)
            .map(|part| part.map(|r| r.map(Frame::data)))
    }
}

fn empty() -> Body {
    Empty::new().map_err(|never| match never {}).boxed()
}

fn whole(bytes: impl Into<Bytes>) -> Body {
    Full::new(bytes.into())
        .map_err(|never| match never {})
        .boxed()
}

fn status(code: StatusCode) -> Response<Body> {
    let mut response = Response::new(empty());
    *response.status_mut() = code;
    response
}

/** The port kept from an earlier start. */
fn kept_port() -> Option<u16> {
    let text = std::fs::read_to_string(files::root().join(PORT_FILE)).ok()?;
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()?
        .get("port")?
        .as_u64()?
        .try_into()
        .ok()
}

async fn bind() -> io::Result<tokio::net::TcpListener> {
    let kept = kept_port();
    let tried = kept.into_iter().chain(PORT..PORT + PORTS_TRIED).chain([0]);
    let mut last = None;
    for port in tried {
        match tokio::net::TcpListener::bind(("0.0.0.0", port)).await {
            Ok(listener) => {
                let port = listener.local_addr()?.port();
                if kept != Some(port) {
                    let _ = std::fs::write(
                        files::root().join(PORT_FILE),
                        format!("{{\"port\":{port}}}"),
                    );
                }
                return Ok(listener);
            }
            Err(e) => last = Some(e),
        }
    }
    Err(last.unwrap_or_else(|| io::Error::other("no port")))
}

/** Starts listening (once; a page loaded again takes the requests from then on, those it had are
 *  ended): the port. `page` gets each request's head — {id, method, path, headers, body} — and
 *  {gone: id} when its device went away before the answer. */
#[tauri::command]
pub async fn host_start(
    host: tauri::State<'_, Host>,
    page: Channel<serde_json::Value>,
) -> Result<u16, String> {
    if let Ok(shared) = host.shared() {
        *shared.page.lock().unwrap() = page;
        // The page that would have answered them is gone.
        shared.pending.lock().unwrap().clear();
        return Ok(shared.port);
    }
    let listener = bind().await.map_err(|e| e.to_string())?;
    let shared = Arc::new(Shared {
        page: Mutex::new(page),
        pending: Mutex::new(HashMap::new()),
        next: AtomicU64::new(1),
        port: listener.local_addr().map_err(|e| e.to_string())?.port(),
    });
    *host.0.lock().unwrap() = Some(shared.clone());
    let port = shared.port;
    tauri::async_runtime::spawn(accept(shared, listener));
    Ok(port)
}

async fn accept(shared: Arc<Shared>, listener: tokio::net::TcpListener) {
    let room = Arc::new(Semaphore::new(CONNECTIONS));
    loop {
        let Ok(permit) = room.clone().acquire_owned().await else {
            return;
        };
        let Ok((stream, _)) = listener.accept().await else {
            continue;
        };
        let _ = stream.set_nodelay(true);
        let shared = shared.clone();
        tokio::spawn(async move {
            let service = hyper::service::service_fn(move |request| {
                let shared = shared.clone();
                async move { Ok::<_, Infallible>(handle(shared, request).await) }
            });
            let _ = hyper::server::conn::http1::Builder::new()
                .serve_connection(hyper_util::rt::TokioIo::new(stream), service)
                .await;
            drop(permit);
        });
    }
}

/** Tells the page a request's device went away when its answer is dropped unanswered. */
struct Waiting {
    shared: Arc<Shared>,
    id: u64,
    answered: bool,
}

impl Drop for Waiting {
    fn drop(&mut self) {
        if !self.answered
            && self
                .shared
                .pending
                .lock()
                .unwrap()
                .remove(&self.id)
                .is_some()
        {
            let _ = self
                .shared
                .page
                .lock()
                .unwrap()
                .send(serde_json::json!({ "gone": self.id }));
        }
    }
}

async fn handle(shared: Arc<Shared>, request: Request<Incoming>) -> Response<Body> {
    let (parts, body) = request.into_parts();
    // A path, never another host's address (a proxy's request).
    let Some(path) = parts
        .uri
        .path_and_query()
        .map(|p| p.as_str())
        .filter(|p| p.starts_with('/'))
    else {
        return status(StatusCode::BAD_REQUEST);
    };
    let id = shared.next.fetch_add(1, Ordering::Relaxed);
    let headers: Vec<(String, String)> = parts
        .headers
        .iter()
        .filter_map(|(name, value)| {
            Some((name.as_str().to_string(), value.to_str().ok()?.to_string()))
        })
        .collect();
    let has_body = !hyper::body::Body::is_end_stream(&body);
    let (answer, answered) = oneshot::channel();
    let head = parts.method == hyper::Method::HEAD;
    shared.pending.lock().unwrap().insert(
        id,
        Pending {
            answer: Some(answer),
            body: has_body.then(|| Inflow::start(body)),
            sink: None,
            range: parts
                .headers
                .get(header::RANGE)
                .and_then(|v| v.to_str().ok())
                .map(String::from),
            head,
        },
    );
    let mut waiting = Waiting {
        shared: shared.clone(),
        id,
        answered: false,
    };
    let sent = shared.page.lock().unwrap().send(serde_json::json!({
        "id": id,
        "method": parts.method.as_str(),
        "path": path,
        "headers": headers,
        "body": has_body,
    }));
    if sent.is_err() {
        return status(StatusCode::SERVICE_UNAVAILABLE);
    }
    let response = answered.await;
    waiting.answered = true;
    let mut response = response.unwrap_or_else(|_| status(StatusCode::SERVICE_UNAVAILABLE));
    if head {
        *response.body_mut() = empty();
    }
    response
}

/** What the page has the native side send: a file of the app's (absolute, under its data root) or
 *  one of the web app's files built in. */
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Native {
    File(String),
    Asset(String),
}

/** Headers the native side sets itself, or that do not pass on. */
fn passes(name: &str) -> bool {
    !matches!(
        name,
        "content-length"
            | "content-range"
            | "accept-ranges"
            | "transfer-encoding"
            | "connection"
            | "keep-alive"
            | "upgrade"
            | "trailer"
            | "te"
    )
}

fn with_headers(
    status: u16,
    headers: &[(String, String)],
    length: bool,
) -> Result<hyper::http::response::Builder, String> {
    let mut builder = Response::builder().status(status);
    for (name, value) in headers {
        let lower = name.to_ascii_lowercase();
        if !passes(&lower) && !(length && lower == "content-length") {
            continue;
        }
        let (Ok(name), Ok(value)) = (
            HeaderName::from_bytes(lower.as_bytes()),
            HeaderValue::from_str(value),
        ) else {
            continue;
        };
        builder = builder.header(name, value);
    }
    Ok(builder)
}

/** The page's answer to a request: its status and headers, then either a file the native side sends
 *  (`native`) or the body the page sends (`body`: `host_write` … `host_end`), or none. */
#[tauri::command]
pub async fn host_answer<R: Runtime>(
    app: AppHandle<R>,
    host: tauri::State<'_, Host>,
    id: u64,
    status: u16,
    headers: Vec<(String, String)>,
    native: Option<Native>,
    body: bool,
) -> Result<(), String> {
    let shared = host.shared()?;
    let (answer, range, head) = {
        let mut pending = shared.pending.lock().unwrap();
        let p = pending.get_mut(&id).ok_or("gone")?;
        (p.answer.take().ok_or("answered")?, p.range.clone(), p.head)
    };
    let response = match native {
        Some(Native::File(path)) => {
            let builder = with_headers(status, &headers, false)?;
            shared.pending.lock().unwrap().remove(&id);
            file(builder, &path, range.as_deref(), head)
        }
        Some(Native::Asset(path)) => {
            shared.pending.lock().unwrap().remove(&id);
            // Its type is the built file's own.
            let headers: Vec<_> = headers
                .into_iter()
                .filter(|(name, _)| !name.eq_ignore_ascii_case("content-type"))
                .collect();
            asset(&app, with_headers(status, &headers, false)?, &path)
        }
        None if body => {
            let (sink, parts) = mpsc::channel(HELD);
            if let Some(p) = shared.pending.lock().unwrap().get_mut(&id) {
                p.sink = Some(sink);
            }
            with_headers(status, &headers, true)?
                .body(Parts(parts).boxed())
                .map_err(|e| e.to_string())?
        }
        None => {
            shared.pending.lock().unwrap().remove(&id);
            with_headers(status, &headers, true)?
                .body(empty())
                .map_err(|e| e.to_string())?
        }
    };
    answer.send(response).map_err(|_| "gone".to_string())
}

/** A part of an answer's body (base64); fails once its device has gone. */
#[tauri::command]
pub async fn host_write(host: tauri::State<'_, Host>, id: u64, data: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| e.to_string())?;
    let sink = {
        let pending = host
            .shared()?
            .pending
            .lock()
            .unwrap()
            .get(&id)
            .and_then(|p| p.sink.clone());
        pending.ok_or("gone")?
    };
    sink.send(Ok(Bytes::from(bytes)))
        .await
        .map_err(|_| "gone".to_string())
}

/** An answer's body ended: whole, or broken off (`error`: the device sees the connection cut). */
#[tauri::command]
pub async fn host_end(
    host: tauri::State<'_, Host>,
    id: u64,
    error: Option<String>,
) -> Result<(), String> {
    let sink = host
        .shared()?
        .pending
        .lock()
        .unwrap()
        .remove(&id)
        .and_then(|mut p| p.sink.take());
    if let (Some(sink), Some(error)) = (sink, error) {
        let _ = sink.send(Err(io::Error::other(error))).await;
    }
    Ok(())
}

/** A request's body as the page pulls it (the `media` scheme's `/.host/<id>`): what came since, up to
 *  a megabyte, waiting a moment for some; `x-end` once it is whole. None: not such a path. */
pub fn pull(host: &Host, path: &str) -> Option<tauri::http::Response<Vec<u8>>> {
    let id: u64 = path.strip_prefix("/.host/")?.parse().ok()?;
    let answer = |status: StatusCode, end: bool, body: Vec<u8>| {
        let mut builder = tauri::http::Response::builder()
            .status(status)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, files::APP_ORIGIN)
            .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "x-end");
        if end {
            builder = builder.header("x-end", "1");
        }
        builder.body(body).unwrap()
    };
    let body = host.shared().ok().and_then(|s| {
        s.pending
            .lock()
            .unwrap()
            .get(&id)
            .and_then(|p| p.body.clone())
    });
    let Some(body) = body else {
        return Some(answer(StatusCode::OK, true, Vec::new()));
    };
    let read = body.take();
    Some(match read {
        Ok((bytes, end)) => answer(StatusCode::OK, end, bytes),
        Err(_) => answer(StatusCode::BAD_GATEWAY, false, Vec::new()),
    })
}

/** A file of the app's: whole, or the range asked (one; `bytes=a-b`, `a-`, `-n`). */
fn file(
    builder: hyper::http::response::Builder,
    path: &str,
    range: Option<&str>,
    head: bool,
) -> Response<Body> {
    let Some(path) = inside_root(Path::new(path)) else {
        return status(StatusCode::NOT_FOUND);
    };
    let Ok(mut f) = std::fs::File::open(&path) else {
        return status(StatusCode::NOT_FOUND);
    };
    let size = f.metadata().map(|m| m.len()).unwrap_or(0);
    let builder = builder.header(header::ACCEPT_RANGES, "bytes");
    let (start, end, builder) = match range.map(|r| parse_range(r, size)) {
        None | Some(Range::Whole) => (0, size, builder),
        Some(Range::Unsatisfiable) => {
            return builder
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{size}"))
                .body(empty())
                .unwrap()
        }
        Some(Range::Part(start, end)) => (
            start,
            end + 1,
            builder
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}")),
        ),
    };
    let builder = builder.header(header::CONTENT_LENGTH, end - start);
    if head || start == end {
        return builder.body(empty()).unwrap();
    }
    if f.seek(SeekFrom::Start(start)).is_err() {
        return status(StatusCode::INTERNAL_SERVER_ERROR);
    }
    let (sink, parts) = mpsc::channel(HELD);
    // Read on a thread of its own as the device takes it; stopped once the device has gone.
    tauri::async_runtime::spawn_blocking(move || {
        let mut left = end - start;
        let mut buf = vec![0; PART];
        while left > 0 {
            let n = buf.len().min(left as usize);
            let part = f
                .read_exact(&mut buf[..n])
                .map(|_| Bytes::copy_from_slice(&buf[..n]));
            let failed = part.is_err();
            if sink.blocking_send(part).is_err() || failed {
                return;
            }
            left -= n as u64;
        }
    });
    builder.body(Parts(parts).boxed()).unwrap()
}

/** A path under the app's data root (links resolved), or none. */
fn inside_root(path: &Path) -> Option<PathBuf> {
    let root = files::root().canonicalize().ok()?;
    let path = path.canonicalize().ok()?;
    (path.starts_with(&root) && path.is_file()).then_some(path)
}

#[derive(Debug, PartialEq)]
enum Range {
    Whole,
    Part(u64, u64),
    Unsatisfiable,
}

/** A Range header against a file's size: one range, inclusive; several or a malformed one: the whole. */
fn parse_range(header: &str, size: u64) -> Range {
    let Some(spec) = header.trim().strip_prefix("bytes=") else {
        return Range::Whole;
    };
    if spec.contains(',') {
        return Range::Whole;
    }
    let Some((a, b)) = spec.trim().split_once('-') else {
        return Range::Whole;
    };
    let (a, b) = (a.trim(), b.trim());
    let parsed = match (a.parse::<u64>().ok(), b.parse::<u64>().ok()) {
        (Some(start), None) if b.is_empty() => Some((start, size.saturating_sub(1))),
        (Some(start), Some(end)) if start <= end => Some((start, end.min(size.saturating_sub(1)))),
        (None, Some(n)) if a.is_empty() => {
            if n == 0 {
                return Range::Unsatisfiable;
            }
            Some((size.saturating_sub(n), size.saturating_sub(1)))
        }
        _ => return Range::Whole,
    };
    match parsed {
        Some((start, end)) if start < size && start <= end => Range::Part(start, end),
        _ => Range::Unsatisfiable,
    }
}

/** One of the web app's files built into the app (as the page loads them). */
fn asset<R: Runtime>(
    app: &AppHandle<R>,
    builder: hyper::http::response::Builder,
    path: &str,
) -> Response<Body> {
    match app.asset_resolver().get(path.to_string()) {
        Some(asset) => builder
            .header(header::CONTENT_TYPE, web_type(path).unwrap_or(&asset.mime_type))
            .header(header::CONTENT_LENGTH, asset.bytes.len())
            .body(whole(asset.bytes))
            .unwrap(),
        None => status(StatusCode::NOT_FOUND),
    }
}

/** The type of a kind of file the web app's build has (Tauri's own knows few: a manifest, a font). */
fn web_type(path: &str) -> Option<&'static str> {
    Some(match path.rsplit_once('.')?.1 {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "webmanifest" => "application/manifest+json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "wasm" => "application/wasm",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges() {
        assert_eq!(parse_range("bytes=0-99", 1000), Range::Part(0, 99));
        assert_eq!(parse_range("bytes=500-", 1000), Range::Part(500, 999));
        assert_eq!(parse_range("bytes=-100", 1000), Range::Part(900, 999));
        assert_eq!(parse_range("bytes=900-5000", 1000), Range::Part(900, 999));
        assert_eq!(parse_range("bytes=1000-", 1000), Range::Unsatisfiable);
        assert_eq!(parse_range("bytes=-0", 1000), Range::Unsatisfiable);
        assert_eq!(parse_range("bytes=0-1,5-6", 1000), Range::Whole);
        assert_eq!(parse_range("items=0-1", 1000), Range::Whole);
        assert_eq!(parse_range("bytes=5-2", 1000), Range::Whole);
        assert_eq!(parse_range("bytes=0-", 0), Range::Unsatisfiable);
    }

    #[test]
    fn files_only_under_the_root() {
        let root = files::root();
        std::fs::create_dir_all(root.join("library")).unwrap();
        let inside = root.join("library/a.txt");
        std::fs::write(&inside, "a").unwrap();
        assert!(inside_root(&inside).is_some());
        assert!(inside_root(&root.join("library/../library/a.txt")).is_some());
        assert!(inside_root(&root.join("../../etc/passwd")).is_none());
        assert!(inside_root(Path::new("/etc/hosts")).is_none());
        assert!(inside_root(&root.join("library")).is_none());
    }
}
