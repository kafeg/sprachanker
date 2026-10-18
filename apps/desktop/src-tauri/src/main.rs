// SprachAnker on a computer (macOS, Windows, Linux): the `sprachanker` server bundled beside this
// program, started on the data folder (~/SprachAnker) and kept running — restarted if it stops — while
// the app runs, and its page in the window. The app is the server (owner, 2026-10-15): it starts at
// login (its window hidden) and stays in the tray when its window is closed, so phones reach the server
// as before; the installer's service for the same folder is taken over, its port and address kept.
// Links to other sites open in the browser; downloads go to Downloads; the microphone is the server's
// page's. It updates itself from its page (update.rs). A run on another folder (`SPRACHANKER_HOME`: a
// test's) is a second app beside it: no login start, no single instance.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod system;
mod update;

use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    net::TcpStream,
    path::{Path, PathBuf},
    process::{Child, Command},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, MutexGuard, PoisonError,
    },
    thread,
    time::{Duration, Instant},
};

use system::{is_server, log_file, quiet, terminate, user_home};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    webview::{PermissionKind, PermissionResponse},
    AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_opener::OpenerExt;

/// A server that stops this soon after starting, this many times in a row, is not started again.
const QUICK_STOP: Duration = Duration::from_secs(15);
const QUICK_STOPS: u32 = 5;
/// Started at login: the window stays hidden until asked for.
const HIDDEN: &str = "--hidden";

/// Where the server runs: the data folder, the port, the address it listens on (all, for phones).
#[derive(Clone)]
struct Place {
    home: PathBuf,
    port: u16,
    host: String,
    /// `serve --experimental`: `"experimental": true` in desktop.json (or `SPRACHANKER_EXPERIMENTAL=1`,
    /// which the server reads itself).
    experimental: bool,
}

/// The place: `SPRACHANKER_HOME`, `SPRACHANKER_PORT`, `SPRACHANKER_HOST` as the installer reads them,
/// else what the app keeps in `<home>/desktop.json` — the port and address of the installer's server
/// it took over, kept from then on —, else ~/SprachAnker on 4580, all addresses.
fn place(taken_over: Option<(Option<u16>, Option<String>)>) -> Place {
    let home = std::env::var("SPRACHANKER_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| user_home().join("SprachAnker"));
    let kept_file = home.join("desktop.json");
    let read_kept = || -> serde_json::Value {
        fs::read_to_string(&kept_file)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    };
    if let Some((port, host)) = taken_over {
        let mut kept = read_kept();
        if !kept.is_object() {
            kept = serde_json::json!({});
        }
        kept["port"] = serde_json::json!(port);
        kept["host"] = serde_json::json!(host);
        let _ = fs::create_dir_all(&home);
        let _ = fs::write(&kept_file, kept.to_string());
    }
    let kept = read_kept();
    Place {
        experimental: kept["experimental"].as_bool() == Some(true),
        port: std::env::var("SPRACHANKER_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .or_else(|| kept["port"].as_u64().and_then(|p| u16::try_from(p).ok()))
            .unwrap_or(4580),
        host: std::env::var("SPRACHANKER_HOST")
            .ok()
            .or_else(|| kept["host"].as_str().map(String::from))
            .unwrap_or_else(|| "0.0.0.0".into()),
        home,
    }
}

/// The shell's words (`desktop.*`) in the system's language (English where a catalog lacks one), from
/// the web app's catalogs (build.rs).
fn text(key: &str) -> String {
    let key = key.trim_start_matches("desktop.");
    let strings: serde_json::Value =
        serde_json::from_str(include_str!(concat!(env!("OUT_DIR"), "/strings.json"))).unwrap();
    let locale = sys_locale::get_locale().unwrap_or_default();
    let language = locale.split(['-', '_']).next().unwrap_or("en");
    [language, "en"]
        .iter()
        .find_map(|code| strings[code][key].as_str())
        .unwrap_or(key)
        .to_string()
}

/// The pid in the folder's `server.pid` (the server's own lock: one per folder).
fn served_by(home: &Path) -> Option<u32> {
    fs::read_to_string(home.join("server.pid")).ok()?.trim().parse().ok()
}

/// A server left on the data folder — the app force-quit, or one started by hand — stopped: the app
/// runs the folder's server.
fn stop_stray(home: &Path) {
    let Some(pid) = served_by(home) else { return };
    if !is_server(pid) {
        return;
    }
    terminate(pid);
    let until = Instant::now() + Duration::from_secs(8);
    while is_server(pid) && Instant::now() < until {
        thread::sleep(Duration::from_millis(200));
    }
}

/// Whether a server answers its health check on the port.
fn healthy(port: u16) -> bool {
    let Ok(mut stream) =
        TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_millis(500))
    else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let request = format!("GET /api/health HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut head = [0u8; 16];
    let read = stream.read(&mut head).unwrap_or(0);
    let head = String::from_utf8_lossy(&head[..read]);
    head.starts_with("HTTP/1.1 200") || head.starts_with("HTTP/1.0 200")
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The server's process and whether the app is quitting, under one lock: a quit never misses a
/// server being started.
struct State {
    child: Option<Child>,
    quitting: bool,
}

/// The server, kept running until the app quits.
pub struct Server {
    state: Mutex<State>,
    /// It kept stopping at once: not started again.
    gave_up: AtomicBool,
}

impl Server {
    fn start(place: &Place) -> std::io::Result<Child> {
        let program = std::env::current_exe()?.with_file_name(system::SERVER);
        let log = log_file();
        fs::create_dir_all(log.parent().unwrap())?;
        fs::create_dir_all(&place.home)?;
        let out = OpenOptions::new().create(true).append(true).open(&log)?;
        // SPRACHANKER_DESKTOP: the server says this app updates it (Settings → About).
        let mut command = Command::new(program);
        command
            .args(["serve", "--data"])
            .arg(&place.home)
            .args(["--host", &place.host, "--port", &place.port.to_string()]);
        if place.experimental {
            command.arg("--experimental");
        }
        quiet(
            command
                .env("SPRACHANKER_DESKTOP", "1")
                .current_dir(&place.home)
                .stdout(out.try_clone()?)
                .stderr(out),
        )
        .spawn()
    }

    /// The pid of this app's server while it runs.
    fn pid(&self) -> Option<u32> {
        lock(&self.state).child.as_ref().map(Child::id)
    }

    /// Started, and started again whenever it stops — unless it keeps stopping at once.
    fn supervise(&self, place: &Place) {
        let mut quick = 0;
        loop {
            let started = Instant::now();
            {
                let mut state = lock(&self.state);
                if state.quitting {
                    return;
                }
                match Self::start(place) {
                    Ok(child) => state.child = Some(child),
                    Err(error) => {
                        eprintln!("the server did not start: {error}");
                        self.gave_up.store(true, Ordering::SeqCst);
                        return;
                    }
                }
            }
            loop {
                thread::sleep(Duration::from_millis(500));
                let mut state = lock(&self.state);
                match state.child.as_mut().map(Child::try_wait) {
                    Some(Ok(None)) => continue,
                    _ => {
                        state.child = None;
                        break;
                    }
                }
            }
            quick = if started.elapsed() < QUICK_STOP { quick + 1 } else { 0 };
            if quick >= QUICK_STOPS {
                self.gave_up.store(true, Ordering::SeqCst);
                return;
            }
            thread::sleep(Duration::from_secs(1));
        }
    }

    /// Stopped as a service is (system::terminate), killed if it does not go; not started again.
    pub fn stop(&self) {
        let child = {
            let mut state = lock(&self.state);
            state.quitting = true;
            state.child.take()
        };
        let Some(mut child) = child else { return };
        terminate(child.id());
        let until = Instant::now() + Duration::from_secs(8);
        while Instant::now() < until {
            if let Ok(Some(_)) = child.try_wait() {
                return;
            }
            thread::sleep(Duration::from_millis(100));
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// The server's own address, where the window stays.
fn local(url: &Url, port: u16) -> bool {
    match url.scheme() {
        "tauri" | "about" | "blob" | "data" => true,
        // Windows' WebView2 serves the app's own pages (its start page) at http://tauri.localhost.
        "http" if cfg!(windows) && url.host_str() == Some("tauri.localhost") => url.port().is_none(),
        "http" => {
            matches!(url.host_str(), Some("127.0.0.1" | "localhost")) && url.port() == Some(port)
        }
        _ => false,
    }
}

/// Another site in the browser (the web's own schemes only: nothing local is opened from a page).
fn open_outside(app: &AppHandle, url: &Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

/// The app's own start page (`www/index.html`), on each platform's scheme.
fn start_page() -> Url {
    let origin = if cfg!(windows) { "http://tauri.localhost" } else { "tauri://localhost" };
    Url::parse(&format!("{origin}/index.html")).unwrap()
}

fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// The server could not start, or stopped for good: the start page says so, with where its log is.
fn failed(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let mut page = start_page();
        page.set_fragment(Some(
            &text("desktop.failed").replace("{path}", &log_file().display().to_string()),
        ));
        let _ = window.navigate(page);
        show(app);
    }
}

fn main() {
    let test_run = std::env::var_os("SPRACHANKER_HOME").is_some();
    let default_home = user_home().join("SprachAnker");
    let service = if test_run { None } else { system::service(&default_home) };
    let place = place(service.as_ref().map(|s| (s.port, s.host.clone())));
    let port = place.port;
    let hidden = std::env::args().any(|a| a == HIDDEN);
    let server = Arc::new(Server {
        state: Mutex::new(State { child: None, quitting: false }),
        gave_up: AtomicBool::new(false),
    });

    let mut builder = tauri::Builder::default();
    if !test_run {
        // A second start shows this one's window.
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _, _| show(app)))
            .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![HIDDEN])));
    }
    let app = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![update::install_update])
        .setup({
            let server = server.clone();
            move |app| {
                app.manage(server.clone());
                // The app is the service: started at login, its path kept current.
                if !test_run && system::installed() {
                    let _ = app.autolaunch().enable();
                }
                let window =
                    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                        .title("SprachAnker")
                        .inner_size(1200.0, 820.0)
                        .min_inner_size(380.0, 560.0)
                        .visible(!hidden)
                        .on_navigation({
                            let app = app.handle().clone();
                            move |url| {
                                if local(url, port) {
                                    return true;
                                }
                                open_outside(&app, url);
                                false
                            }
                        })
                        .on_new_window({
                            let app = app.handle().clone();
                            move |url, _| {
                                open_outside(&app, &url);
                                tauri::webview::NewWindowResponse::Deny
                            }
                        })
                        // Downloads (a course's or a profile's file) go to Downloads.
                        .on_download(|_, _| true)
                        // The microphone for the server's page (answers said aloud), asked of no one
                        // else; the system still asks the learner once (macOS).
                        .on_permission_request(move |webview, kind| {
                            let ours = webview.url().is_ok_and(|url| local(&url, port));
                            if ours && kind == PermissionKind::Microphone {
                                PermissionResponse::Allow
                            } else {
                                PermissionResponse::Default
                            }
                        })
                        .build()?;
                // WebKitGTK gives a page no microphone until its settings let media streams in.
                #[cfg(target_os = "linux")]
                let _ = window.with_webview(|webview| {
                    use webkit2gtk::{SettingsExt, WebViewExt};
                    if let Some(settings) = webview.inner().settings() {
                        settings.set_enable_media_stream(true);
                    }
                });

                let open = MenuItem::with_id(app, "open", text("desktop.open"), true, None::<&str>)?;
                let browser =
                    MenuItem::with_id(app, "browser", text("desktop.browser"), true, None::<&str>)?;
                let quit = MenuItem::with_id(app, "quit", text("desktop.quit"), true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&open, &browser, &quit])?;
                TrayIconBuilder::new()
                    .icon(app.default_window_icon().unwrap().clone())
                    .menu(&menu)
                    .on_menu_event(move |app, event| match event.id.as_ref() {
                        "open" => show(app),
                        "browser" => {
                            open_outside(app, &Url::parse(&format!("http://127.0.0.1:{port}/")).unwrap())
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .build(app)?;

                // Away from the window's thread: the installer's server and a stray one stopped, then
                // the app's own kept running.
                let supervised = server.clone();
                let home = place.home.clone();
                let place = place.clone();
                thread::spawn(move || {
                    if let Some(service) = service {
                        system::take_over(&service);
                    }
                    stop_stray(&place.home);
                    supervised.supervise(&place);
                });
                // The window goes to the server once this app's server answers (the folder's
                // `server.pid` is its process: never another server on the port).
                let watched = server.clone();
                thread::spawn(move || loop {
                    if watched.gave_up.load(Ordering::SeqCst) {
                        failed(window.app_handle());
                        return;
                    }
                    let ours = watched.pid().is_some_and(|pid| served_by(&home) == Some(pid));
                    if ours && healthy(port) {
                        let url = format!("http://127.0.0.1:{port}/");
                        let _ = window.navigate(Url::parse(&url).unwrap());
                        // It gives up later (stopping at once, again and again): said then.
                        while !watched.gave_up.load(Ordering::SeqCst) {
                            thread::sleep(Duration::from_secs(1));
                        }
                    } else {
                        thread::sleep(Duration::from_millis(300));
                    }
                });
                Ok(())
            }
        })
        .on_window_event(|window, event| {
            // Closed, the window hides: the server goes on for the phones.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("the app");

    app.run(move |app, event| match event {
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => show(app),
        RunEvent::Exit => server.stop(),
        _ => {}
    });
}
