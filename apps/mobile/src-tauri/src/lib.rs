// The phone app (proof): Whisper in the app's own process — whisper.cpp at the server's version
// through native/asr.c, a model loaded once, answers heard from 16 kHz samples sent raw
// (little-endian f32) — for the page to time against `speech:android`.
use std::sync::Mutex;
use std::time::Instant;

use tauri::ipc::{InvokeBody, Request};

mod files;

#[cfg(target_os = "android")]
mod whisper {
    use std::ffi::{c_char, c_int, c_void, CStr, CString};

    extern "C" {
        fn sa_whisper_load(path: *const c_char) -> *mut c_void;
        fn sa_whisper_hear(
            ctx: *mut c_void,
            samples: *const f32,
            n: c_int,
            threads: c_int,
            lang: *const c_char,
            out: *mut c_char,
            cap: c_int,
        ) -> c_int;
        fn sa_whisper_free(ctx: *mut c_void);
    }

    /// A loaded model (whisper.cpp's context, used by one call at a time).
    pub struct Model(*mut c_void);
    unsafe impl Send for Model {}

    impl Model {
        pub fn load(path: &str) -> Result<Self, String> {
            let c = CString::new(path).map_err(|e| e.to_string())?;
            let ctx = unsafe { sa_whisper_load(c.as_ptr()) };
            if ctx.is_null() {
                return Err(format!("{path}: the model did not load"));
            }
            Ok(Self(ctx))
        }

        pub fn hear(&mut self, samples: &[f32], threads: i32, lang: &str) -> Result<String, String> {
            let lang = CString::new(lang).map_err(|e| e.to_string())?;
            let mut out = vec![0 as c_char; 16 * 1024];
            let n = unsafe {
                sa_whisper_hear(
                    self.0,
                    samples.as_ptr(),
                    samples.len() as c_int,
                    threads,
                    lang.as_ptr(),
                    out.as_mut_ptr(),
                    out.len() as c_int,
                )
            };
            if n < 0 {
                return Err("Whisper failed".into());
            }
            Ok(unsafe { CStr::from_ptr(out.as_ptr()) }.to_string_lossy().trim().to_string())
        }
    }

    impl Drop for Model {
        fn drop(&mut self) {
            unsafe { sa_whisper_free(self.0) }
        }
    }
}

#[cfg(not(target_os = "android"))]
mod whisper {
    /// Whisper is built into the app for Android only so far.
    pub struct Model;
    impl Model {
        pub fn load(_: &str) -> Result<Self, String> {
            Err("Whisper is in the Android build only".into())
        }
        pub fn hear(&mut self, _: &[f32], _: i32, _: &str) -> Result<String, String> {
            Err("Whisper is in the Android build only".into())
        }
    }
}

#[derive(Default)]
struct Asr(Mutex<Option<whisper::Model>>);

#[derive(serde::Serialize)]
struct Heard {
    text: String,
    /// Whisper's own time, the samples' passage over IPC aside.
    ms: u128,
}

/// Loads a model file: how long it took.
#[tauri::command]
fn load(asr: tauri::State<Asr>, path: String) -> Result<u128, String> {
    let started = Instant::now();
    let model = whisper::Model::load(&path)?;
    *asr.0.lock().unwrap() = Some(model);
    Ok(started.elapsed().as_millis())
}

/// What was said in the samples (the body) in a language given (`lang`, German by default), with the
/// threads in the `threads` header.
#[tauri::command]
fn transcribe(asr: tauri::State<Asr>, request: Request) -> Result<Heard, String> {
    // Raw where the platform's IPC carries bytes; a JSON array of them where it does not (Android).
    let bytes: Vec<u8> = match request.body() {
        InvokeBody::Raw(bytes) => bytes.clone(),
        InvokeBody::Json(serde_json::Value::Array(values)) => {
            values.iter().map(|v| v.as_u64().unwrap_or(0) as u8).collect()
        }
        _ => return Err("f32 samples expected".into()),
    };
    let threads = request
        .headers()
        .get("threads")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .unwrap_or(4);
    let samples: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect();
    let mut guard = asr.0.lock().unwrap();
    let model = guard.as_mut().ok_or("no model loaded")?;
    let started = Instant::now();
    let lang = request
        .headers()
        .get("lang")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("de")
        .to_string();
    let text = model.hear(&samples, threads, &lang)?;
    Ok(Heard { text, ms: started.elapsed().as_millis() })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Asr::default())
        .register_asynchronous_uri_scheme_protocol("media", |_ctx, request, responder| {
            std::thread::spawn(move || responder.respond(files::serve(&request)));
        })
        .invoke_handler(tauri::generate_handler![
            load,
            transcribe,
            files::fs_list,
            files::fs_write,
            files::fs_remove,
            files::fs_root
        ])
        .run(tauri::generate_context!())
        .expect("the app failed to start");
}
