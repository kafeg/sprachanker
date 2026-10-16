// The reading-aloud engines the app carries — Piper's `sherpa-onnx-offline-tts` and Qwen3-TTS's
// `tts-server`, built in native/ for the phone and packed as `libsa_<engine>.so` beside the app's own
// library, the one folder Android lets an app run programs from — run as the server runs them on a
// computer: a process with its arguments, its end awaited, stopped; what it said on stderr kept. A
// request to one listening on 127.0.0.1 is made here: the page's own requests cannot reach it (CORS,
// and Android's ban on cleartext). A Piper voice's archive (.tar.bz2) is unpacked here too.
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// How much of the end of what an engine says on stderr is kept.
const LOG_KEPT: usize = 4000;

struct Running {
    child: Child,
    log: Arc<Mutex<String>>,
}

/// The engines' processes running, by pid.
#[derive(Default)]
pub struct Engines(Mutex<HashMap<u32, Running>>);

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

/// Starts an engine with its arguments: its pid.
#[tauri::command]
pub fn engine_spawn(
    engines: tauri::State<Engines>,
    engine: String,
    args: Vec<String>,
) -> Result<u32, String> {
    let path = program(&engine).ok_or(format!("{engine}: not in this app"))?;
    let mut child = Command::new(path)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("{engine}: {e}"))?;
    let log = Arc::new(Mutex::new(String::new()));
    if let Some(mut stderr) = child.stderr.take() {
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
        });
    }
    let pid = child.id();
    engines.0.lock().unwrap().insert(pid, Running { child, log });
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
#[tauri::command(async)]
pub fn engine_wait(engines: tauri::State<Engines>, pid: u32) -> Ended {
    loop {
        {
            let mut all = engines.0.lock().unwrap();
            let Some(running) = all.get_mut(&pid) else {
                return Ended { code: -1, log: String::new() };
            };
            if let Ok(Some(status)) = running.child.try_wait() {
                // What it said is read to its end (its pipe closed) before it is given.
                std::thread::sleep(Duration::from_millis(50));
                let log = running.log.lock().unwrap().clone();
                all.remove(&pid);
                return Ended { code: status.code().unwrap_or(-1), log };
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// Stops an engine.
#[tauri::command]
pub fn engine_kill(engines: tauri::State<Engines>, pid: u32) {
    if let Some(running) = engines.0.lock().unwrap().get_mut(&pid) {
        let _ = running.child.kill();
    }
}

/// A free port on 127.0.0.1.
#[tauri::command]
pub fn free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    Ok(listener.local_addr().map_err(|e| e.to_string())?.port())
}

/// A request to an engine on 127.0.0.1 (`body`: JSON): its answer as two bytes of status, then the
/// body. `timeout`: how long its answer may take, in ms.
#[tauri::command(async)]
pub fn local_http(
    port: u16,
    method: String,
    path: String,
    body: Option<String>,
    timeout: u64,
) -> Result<tauri::ipc::Response, String> {
    let (status, answer) = http(port, &method, &path, body.as_deref().unwrap_or(""), timeout)
        .map_err(|e| format!("127.0.0.1:{port}{path}: {e}"))?;
    let mut out = status.to_be_bytes().to_vec();
    out.extend(answer);
    Ok(tauri::ipc::Response::new(out))
}

fn http(port: u16, method: &str, path: &str, body: &str, timeout: u64) -> std::io::Result<(u16, Vec<u8>)> {
    let bad = |what: &str| std::io::Error::new(std::io::ErrorKind::InvalidData, what.to_string());
    let mut s = TcpStream::connect(("127.0.0.1", port))?;
    s.set_read_timeout(Some(Duration::from_millis(timeout.max(1))))?;
    s.set_write_timeout(Some(Duration::from_millis(timeout.max(1))))?;
    write!(
        s,
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\
         Content-Type: application/json\r\nContent-Length: {}\r\n\r\n",
        body.len()
    )?;
    s.write_all(body.as_bytes())?;
    let mut all = Vec::new();
    s.read_to_end(&mut all)?;
    let end = all.windows(4).position(|w| w == b"\r\n\r\n").ok_or_else(|| bad("no head"))?;
    let head = String::from_utf8_lossy(&all[..end]).to_string();
    let rest = &all[end + 4..];
    let status = head
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| bad("no status"))?;
    let header = |name: &str| {
        head.lines().skip(1).find_map(|l| {
            let (k, v) = l.split_once(':')?;
            k.trim().eq_ignore_ascii_case(name).then(|| v.trim().to_string())
        })
    };
    let body = if header("transfer-encoding").is_some_and(|v| v.eq_ignore_ascii_case("chunked")) {
        dechunk(rest).ok_or_else(|| bad("broken chunks"))?
    } else if let Some(n) = header("content-length").and_then(|v| v.parse::<usize>().ok()) {
        rest.get(..n).ok_or_else(|| bad("cut short"))?.to_vec()
    } else {
        rest.to_vec()
    };
    Ok((status, body))
}

/// A chunked body's bytes.
fn dechunk(mut rest: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    loop {
        let line = rest.windows(2).position(|w| w == b"\r\n")?;
        let size = std::str::from_utf8(&rest[..line]).ok()?.split(';').next()?.trim();
        let n = usize::from_str_radix(size, 16).ok()?;
        rest = &rest[line + 2..];
        if n == 0 {
            return Some(out);
        }
        out.extend_from_slice(rest.get(..n)?);
        rest = rest.get(n + 2..)?;
    }
}

/// A .tar.bz2 archive unpacked into a folder (made; nothing in it may leave it).
#[tauri::command(async)]
pub fn untar_bz2(archive: String, into: String) -> Result<(), String> {
    let file = File::open(&archive).map_err(|e| format!("{archive}: {e}"))?;
    std::fs::create_dir_all(&into).map_err(|e| format!("{into}: {e}"))?;
    let mut tar = tar::Archive::new(bzip2::read::BzDecoder::new(BufReader::new(file)));
    // `unpack` keeps every entry inside the folder (no absolute paths, no `..`).
    tar.unpack(&into).map_err(|e| format!("{archive}: {e}"))
}

/// A file an engine wrote (its reading) read and removed: under the engines' own folder only.
#[tauri::command(async)]
pub fn engine_output(name: String) -> Result<tauri::ipc::Response, String> {
    if name.contains('/') || name.starts_with('.') {
        return Err(format!("{name}: not an engine's output"));
    }
    let path = outputs().join(&name);
    let bytes = std::fs::read(&path).map_err(|e| format!("{name}: {e}"))?;
    let _ = std::fs::remove_file(&path);
    Ok(tauri::ipc::Response::new(bytes))
}

/// Where the engines write what they make (the app's cache beside its data root), made.
fn outputs() -> PathBuf {
    let dir = crate::files::root()
        .parent()
        .map(|p| p.join("cache").join("engines"))
        .unwrap_or_else(|| std::env::temp_dir().join("sprachanker-engines"));
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// The folder engines write their output into (an absolute path for their arguments).
#[tauri::command]
pub fn engine_outputs() -> String {
    outputs().to_string_lossy().to_string()
}
