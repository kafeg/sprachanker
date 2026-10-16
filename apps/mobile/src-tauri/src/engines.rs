// The reading-aloud engines the app carries — Piper's `sherpa-onnx-offline-tts` and Qwen3-TTS's
// `tts-server`, built in native/ for the phone and packed as `libsa_<engine>.so` beside the app's own
// library, the one folder Android lets an app run programs from — run as the server runs them on a
// computer: a process with its arguments, its end awaited, stopped; what it said on stderr kept. A
// request to one listening on 127.0.0.1 is made here: the page's own requests cannot reach it (CORS,
// and Android's ban on cleartext). A Piper voice's archive (.tar.bz2) is unpacked here too. What
// waits (an engine's end, its answer, an archive) waits on a blocking thread, never on the async
// runtime's few workers that every other command needs.
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::JoinHandle;
use std::time::Duration;

use tauri::async_runtime::spawn_blocking;

/// How much of the end of what an engine says on stderr is kept.
const LOG_KEPT: usize = 4000;
/// The memory killer's score an engine runs with: after the apps in the background (900 and up),
/// before the app itself — an engine holding gigabytes goes first, the app stays.
const OOM_SCORE_ADJ: i32 = 500;

struct Running {
    child: Child,
    log: Arc<Mutex<String>>,
    reader: Option<JoinHandle<()>>,
}

/// The engines' processes running, by pid.
#[derive(Default, Clone)]
pub struct Engines(Arc<Mutex<HashMap<u32, Running>>>);

/// The folder the app's native libraries are in: where its own library was loaded from.
fn library_dir() -> Option<PathBuf> {
    let maps = std::fs::read_to_string("/proc/self/maps").ok()?;
    let own = maps
        .lines()
        .filter_map(|l| l.split_whitespace().nth(5))
        .find(|p| p.ends_with("/libsprachanker_mobile_lib.so"))?;
    PathBuf::from(own).parent().map(|p| p.to_path_buf())
}

/// An engine's program, if the app carries it.
fn program(engine: &str) -> Option<PathBuf> {
    if !matches!(engine, "piper" | "qwen") {
        return None;
    }
    let path = library_dir()?.join(format!("libsa_{engine}.so"));
    path.exists().then_some(path)
}

/// The engines this app carries (of "piper", "qwen").
#[tauri::command]
pub fn engines_built() -> Vec<String> {
    ["piper", "qwen"]
        .into_iter()
        .filter(|e| program(e).is_some())
        .map(String::from)
        .collect()
}

/// Starts an engine with its arguments: its pid. It is started by the system's shell, which sets its
/// memory killer's score (OOM_SCORE_ADJ) and becomes it.
#[tauri::command]
pub fn engine_spawn(
    engines: tauri::State<Engines>,
    engine: String,
    args: Vec<String>,
) -> Result<u32, String> {
    let path = program(&engine).ok_or(format!("{engine}: not in this app"))?;
    let mut child = Command::new("/system/bin/sh")
        .arg("-c")
        .arg(format!(
            "echo {OOM_SCORE_ADJ} > /proc/self/oom_score_adj; exec \"$0\" \"$@\""
        ))
        .arg(path)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("{engine}: {e}"))?;
    let log = Arc::new(Mutex::new(String::new()));
    let reader = child.stderr.take().map(|mut stderr| {
        let log = log.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n) = stderr.read(&mut buf) {
                if n == 0 {
                    break;
                }
                let mut kept = log.lock().unwrap();
                kept.push_str(&String::from_utf8_lossy(&buf[..n]));
                if kept.len() > LOG_KEPT {
                    let mut cut = kept.len() - LOG_KEPT;
                    while !kept.is_char_boundary(cut) {
                        cut += 1;
                    }
                    kept.drain(..cut);
                }
            }
        })
    });
    let pid = child.id();
    engines
        .0
        .lock()
        .unwrap()
        .insert(pid, Running { child, log, reader });
    Ok(pid)
}

#[derive(serde::Serialize)]
pub struct Ended {
    /// Its exit code (-1: ended by a signal, or not known).
    code: i32,
    /// The end of what it said on stderr.
    log: String,
}

/// Waits for an engine to end.
#[tauri::command]
pub async fn engine_wait(engines: tauri::State<'_, Engines>, pid: u32) -> Result<Ended, String> {
    let all = engines.inner().0.clone();
    spawn_blocking(move || loop {
        let ended = {
            let mut running = all.lock().unwrap();
            let Some(r) = running.get_mut(&pid) else {
                return Ended {
                    code: -1,
                    log: String::new(),
                };
            };
            match r.child.try_wait() {
                Ok(Some(status)) => running.remove(&pid).map(|r| (status, r)),
                Ok(None) => None,
                Err(_) => running
                    .remove(&pid)
                    .map(|r| (std::process::ExitStatus::default(), r)),
            }
        };
        if let Some((status, r)) = ended {
            // What it said, read to the end of its pipe.
            if let Some(reader) = r.reader {
                let _ = reader.join();
            }
            let log = r.log.lock().unwrap().clone();
            return Ended {
                code: status.code().unwrap_or(-1),
                log,
            };
        }
        std::thread::sleep(Duration::from_millis(100));
    })
    .await
    .map_err(|e| e.to_string())
}

/// Stops an engine.
#[tauri::command]
pub fn engine_kill(engines: tauri::State<Engines>, pid: u32) {
    if let Some(running) = engines.0.lock().unwrap().get_mut(&pid) {
        let _ = running.child.kill();
    }
}

/// Stops every engine (the page started again: none of them has its owner any more).
#[tauri::command]
pub fn engines_stop_all(engines: tauri::State<Engines>) {
    for running in engines.0.lock().unwrap().values_mut() {
        let _ = running.child.kill();
    }
}

/// A free port on 127.0.0.1.
#[tauri::command]
pub fn free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    Ok(listener.local_addr().map_err(|e| e.to_string())?.port())
}

/// A request to an engine on 127.0.0.1 (`path` with its query; `body`: JSON): its answer as two bytes
/// of status, then the body. `timeout`: how long its answer may take, in ms.
#[tauri::command]
pub async fn local_http(
    port: u16,
    method: String,
    path: String,
    body: Option<String>,
    timeout: u64,
) -> Result<tauri::ipc::Response, String> {
    spawn_blocking(move || {
        let (status, answer) = http(port, &method, &path, body.as_deref().unwrap_or(""), timeout)
            .map_err(|e| format!("127.0.0.1:{port}{path}: {e}"))?;
        let mut out = status.to_be_bytes().to_vec();
        out.extend(answer);
        Ok(tauri::ipc::Response::new(out))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn http(
    port: u16,
    method: &str,
    path: &str,
    body: &str,
    timeout: u64,
) -> std::io::Result<(u16, Vec<u8>)> {
    let bad = |what: &str| std::io::Error::new(std::io::ErrorKind::InvalidData, what.to_string());
    let wait = Some(Duration::from_millis(timeout.max(1)));
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let mut s = TcpStream::connect_timeout(&addr, Duration::from_millis(timeout.clamp(1, 5000)))?;
    s.set_read_timeout(wait)?;
    s.set_write_timeout(wait)?;
    write!(
        s,
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\
         Content-Type: application/json\r\nContent-Length: {}\r\n\r\n",
        body.len()
    )?;
    s.write_all(body.as_bytes())?;
    let mut r = BufReader::new(s);
    let mut line = String::new();
    r.read_line(&mut line)?;
    let status = line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| bad("no status"))?;
    let (mut length, mut chunked) = (None, false);
    loop {
        line.clear();
        if r.read_line(&mut line)? == 0 {
            return Err(bad("cut short"));
        }
        let l = line.trim_end();
        if l.is_empty() {
            break;
        }
        if let Some((k, v)) = l.split_once(':') {
            let (k, v) = (k.trim(), v.trim());
            if k.eq_ignore_ascii_case("content-length") {
                length = v.parse::<usize>().ok();
            } else if k.eq_ignore_ascii_case("transfer-encoding") {
                chunked = v.eq_ignore_ascii_case("chunked");
            }
        }
    }
    let body = if chunked {
        let mut rest = Vec::new();
        r.read_to_end(&mut rest)?;
        dechunk(&rest).ok_or_else(|| bad("broken chunks"))?
    } else if let Some(n) = length {
        let mut out = vec![0; n];
        r.read_exact(&mut out)?;
        out
    } else {
        let mut rest = Vec::new();
        r.read_to_end(&mut rest)?;
        rest
    };
    Ok((status, body))
}

/// A chunked body's bytes.
fn dechunk(mut rest: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    loop {
        let line = rest.windows(2).position(|w| w == b"\r\n")?;
        let size = std::str::from_utf8(&rest[..line])
            .ok()?
            .split(';')
            .next()?
            .trim();
        let n = usize::from_str_radix(size, 16).ok()?;
        rest = &rest[line + 2..];
        if n == 0 {
            return Some(out);
        }
        out.extend_from_slice(rest.get(..n)?);
        rest = rest.get(n + 2..)?;
    }
}

/// An absolute path in the app's data root (no `.` or `..`), or an error.
fn in_root(path: &str) -> Result<PathBuf, String> {
    let p = Path::new(path);
    let inside = p.starts_with(crate::files::root())
        && p.components()
            .all(|c| matches!(c, Component::RootDir | Component::Normal(_)));
    inside
        .then(|| p.to_path_buf())
        .ok_or(format!("{path}: outside the app's files"))
}

/// A .tar.bz2 archive in the data root unpacked into a folder there (made; nothing in it may leave it).
#[tauri::command]
pub async fn untar_bz2(archive: String, into: String) -> Result<(), String> {
    let (from, to) = (in_root(&archive)?, in_root(&into)?);
    spawn_blocking(move || {
        let file = File::open(&from).map_err(|e| format!("{archive}: {e}"))?;
        std::fs::create_dir_all(&to).map_err(|e| format!("{into}: {e}"))?;
        let mut tar = tar::Archive::new(bzip2::read::BzDecoder::new(BufReader::new(file)));
        // `unpack` keeps every entry inside the folder (no absolute paths, no `..`, no link out).
        tar.unpack(&to).map_err(|e| format!("{archive}: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A file an engine wrote (its reading) read and removed: in the engines' own folder only.
#[tauri::command]
pub async fn engine_output(name: String) -> Result<tauri::ipc::Response, String> {
    if name.contains('/') || name.starts_with('.') {
        return Err(format!("{name}: not an engine's output"));
    }
    spawn_blocking(move || {
        let path = outputs().join(&name);
        let bytes = std::fs::read(&path).map_err(|e| format!("{name}: {e}"))?;
        let _ = std::fs::remove_file(&path);
        Ok(tauri::ipc::Response::new(bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Where the engines write what they make (the app's cache beside its data root): made, and emptied
/// of what a run before left the first time it is asked for.
fn outputs() -> PathBuf {
    static DIR: OnceLock<PathBuf> = OnceLock::new();
    DIR.get_or_init(|| {
        let dir = crate::files::root()
            .parent()
            .map(|p| p.join("cache").join("engines"))
            .unwrap_or_else(|| std::env::temp_dir().join("sprachanker-engines"));
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);
        dir
    })
    .clone()
}

/// The folder engines write their output into (an absolute path for their arguments).
#[tauri::command]
pub fn engine_outputs() -> String {
    outputs().to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A server on a free port answering one request with `answer`.
    fn serve(answer: &'static [u8]) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            // The whole request read (else closing with it unread resets the connection).
            let mut asked = Vec::new();
            let mut buf = [0u8; 4096];
            while let Ok(n) = s.read(&mut buf) {
                asked.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&asked);
                let Some(end) = text.find("\r\n\r\n") else {
                    continue;
                };
                let length = text
                    .lines()
                    .find_map(|l| l.strip_prefix("Content-Length: "))
                    .and_then(|v| v.trim().parse::<usize>().ok())
                    .unwrap_or(0);
                if asked.len() >= end + 4 + length || n == 0 {
                    break;
                }
            }
            s.write_all(answer).unwrap();
        });
        port
    }

    #[test]
    fn an_answer_by_its_length_or_in_chunks() {
        let port = serve(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nX: y\r\n\r\nRIFF");
        assert_eq!(
            http(port, "POST", "/v1/audio/speech", "{}", 2000).unwrap(),
            (200, b"RIFF".to_vec())
        );
        let port = serve(b"HTTP/1.1 400 Bad\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n2\r\nde\r\n0\r\n\r\n");
        assert_eq!(
            http(port, "GET", "/health", "", 2000).unwrap(),
            (400, b"abcde".to_vec())
        );
        assert_eq!(dechunk(b"3\r\nabc\r\n"), None);
    }

    #[test]
    fn only_the_data_root() {
        let root = crate::files::root();
        assert!(in_root(&root.join("models/voices/x.part").to_string_lossy()).is_ok());
        assert!(in_root("/etc/passwd").is_err());
        assert!(in_root(&root.join("../x").to_string_lossy()).is_err());
    }
}
