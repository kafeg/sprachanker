// The app's files under its data root (on Android the app's own folder on the shared storage, where
// `adb push` reaches it): listed, written whole, removed — paths relative to the root, never
// leaving it — and served to the page by the `media` scheme (http://media.localhost/<path>), byte
// ranges and all, so films play and seek straight from the disk.
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use base64::Engine;
use tauri::http::{header, Request, Response, StatusCode};

pub fn root() -> PathBuf {
    #[cfg(target_os = "android")]
    {
        PathBuf::from("/sdcard/Android/data/app.sprachanker.mobile/files")
    }
    #[cfg(not(target_os = "android"))]
    {
        std::env::temp_dir().join("sprachanker-mobile")
    }
}

/// A path under the root, or none when it would leave it.
fn under(path: &str) -> Option<PathBuf> {
    let rel = Path::new(path.trim_start_matches('/'));
    if rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return None;
    }
    Some(root().join(rel))
}

#[derive(serde::Serialize)]
pub struct Entry {
    path: String,
    size: u64,
    mtime: u64,
}

fn walk(dir: &Path, base: &Path, out: &mut Vec<Entry>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            walk(&path, base, out);
        } else if let Ok(rel) = path.strip_prefix(base) {
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            out.push(Entry { path: rel.to_string_lossy().into_owned(), size: meta.len(), mtime });
        }
    }
}

/// Every file under a folder of the root (its path relative to the root), its size and time.
#[tauri::command]
pub fn fs_list(path: String) -> Result<Vec<Entry>, String> {
    let dir = under(&path).ok_or("outside the app's files")?;
    let mut out = Vec::new();
    walk(&dir, &root(), &mut out);
    Ok(out)
}

/// A file written whole (base64), through a part file renamed into place.
#[tauri::command]
pub fn fs_write(path: String, base64: String) -> Result<(), String> {
    let file = under(&path).ok_or("outside the app's files")?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(base64).map_err(|e| e.to_string())?;
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let part = file.with_extension("part");
    fs::write(&part, bytes).map_err(|e| e.to_string())?;
    fs::rename(&part, &file).map_err(|e| e.to_string())
}

/// A file or a folder removed (nothing when it is not there).
#[tauri::command]
pub fn fs_remove(path: String) -> Result<(), String> {
    let file = under(&path).ok_or("outside the app's files")?;
    if file.is_dir() {
        fs::remove_dir_all(&file).map_err(|e| e.to_string())
    } else if file.exists() {
        fs::remove_file(&file).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

/// The root's absolute path (the server's data root on the page's side).
#[tauri::command]
pub fn fs_root() -> String {
    root().to_string_lossy().into_owned()
}

fn media_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "wav" => "audio/wav",
        "ogg" | "oga" => "audio/ogg",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "pdf" => "application/pdf",
        "json" => "application/json",
        "vtt" => "text/vtt",
        _ => "application/octet-stream",
    }
}

fn answer(status: StatusCode, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(body)
        .unwrap()
}

/// A file of the root as the `media` scheme serves it: whole, or the range asked.
pub fn serve(request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let path = percent_decode(request.uri().path());
    // A recording of a profile's by its id alone (`/recording/<id>`): the file named so, any type.
    let file = match path.strip_prefix("/recording/") {
        Some(id) => recording(id),
        None => under(&path).filter(|f| f.is_file()),
    };
    let Some(file) = file else { return answer(StatusCode::NOT_FOUND, Vec::new()) };
    let Ok(mut f) = fs::File::open(&file) else { return answer(StatusCode::NOT_FOUND, Vec::new()) };
    let size = f.metadata().map(|m| m.len()).unwrap_or(0);
    let kind = media_type(&file);
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("bytes="))
        .and_then(|v| {
            let (a, b) = v.split_once('-')?;
            let start: u64 = a.parse().ok()?;
            let end: u64 = if b.is_empty() { size.saturating_sub(1) } else { b.parse().ok()? };
            Some((start, end.min(size.saturating_sub(1))))
        });
    match range {
        Some((start, end)) if start < size => {
            // To the end asked, whole: Android's WebView plays nothing from a range answered in part.
            let mut body = vec![0; (end - start + 1) as usize];
            if f.seek(SeekFrom::Start(start)).is_err() || f.read_exact(&mut body).is_err() {
                return answer(StatusCode::INTERNAL_SERVER_ERROR, Vec::new());
            }
            Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .header(header::CONTENT_TYPE, kind)
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"))
                .body(body)
                .unwrap()
        }
        Some(_) => Response::builder()
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::CONTENT_RANGE, format!("bytes */{size}"))
            .body(Vec::new())
            .unwrap(),
        None => {
            let mut body = Vec::with_capacity(size as usize);
            if f.read_to_end(&mut body).is_err() {
                return answer(StatusCode::INTERNAL_SERVER_ERROR, Vec::new());
            }
            Response::builder()
                .status(StatusCode::OK)
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .header(header::CONTENT_TYPE, kind)
                .header(header::ACCEPT_RANGES, "bytes")
                .body(body)
                .unwrap()
        }
    }
}

/// A learner's recording by its id: `profiles/*/recordings/<id>.*` (ids are unique across profiles).
fn recording(id: &str) -> Option<PathBuf> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return None;
    }
    let profiles = fs::read_dir(root().join("profiles")).ok()?;
    for profile in profiles.flatten() {
        let Ok(files) = fs::read_dir(profile.path().join("recordings")) else { continue };
        for file in files.flatten() {
            let name = file.file_name();
            let name = name.to_string_lossy();
            if name.split('.').next() == Some(id) {
                return Some(file.path());
            }
        }
    }
    None
}

fn percent_decode(path: &str) -> String {
    let bytes = path.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&path[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
