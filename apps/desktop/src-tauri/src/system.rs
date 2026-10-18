// What differs between the systems the app runs on: the home folder, where the server's log goes, the
// installer's service for the data folder (macOS: a LaunchAgent; Linux: a systemd user unit; Windows:
// none), how a process is named and stopped, and whether this program is the installed one.
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

/// The server's program beside this one.
pub const SERVER: &str = if cfg!(windows) { "sprachanker.exe" } else { "sprachanker" };

pub fn user_home() -> PathBuf {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    PathBuf::from(std::env::var(var).unwrap_or_default())
}

/// A command run without a console window of its own (Windows opens one for a console program).
pub fn quiet(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// The server's log: the system's place for logs (~/Library/Logs/SprachAnker on a Mac,
/// %LOCALAPPDATA%\SprachAnker on Windows, ~/.local/state/sprachanker on Linux); a run on another
/// folder (a test's) keeps its own there, never mixed into the app's.
pub fn log_file() -> PathBuf {
    if let Some(home) = std::env::var_os("SPRACHANKER_HOME") {
        return PathBuf::from(home).join("serve.log");
    }
    let dir = if cfg!(target_os = "macos") {
        user_home().join("Library/Logs/SprachAnker")
    } else if cfg!(windows) {
        std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| user_home().join("AppData/Local"))
            .join("SprachAnker")
    } else {
        std::env::var_os("XDG_STATE_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| user_home().join(".local/state"))
            .join("sprachanker")
    };
    dir.join("serve.log")
}

/// The installer's service for the data folder, if there is one: its file, port and address.
pub struct Service {
    pub file: PathBuf,
    pub port: Option<u16>,
    pub host: Option<String>,
}

/// The LaunchAgent `install.sh` makes on a Mac.
#[cfg(target_os = "macos")]
const LAUNCH_AGENT: &str = "app.sprachanker.server";

#[cfg(target_os = "macos")]
pub fn service(home: &Path) -> Option<Service> {
    let file = user_home().join(format!("Library/LaunchAgents/{LAUNCH_AGENT}.plist"));
    let body = fs::read_to_string(&file).ok()?;
    if !body.contains(&format!("<string>{}</string>", home.display())) {
        return None;
    }
    // ProgramArguments: <string>--port</string><string>4600</string>, alike --host.
    let after = |flag: &str| {
        let tag = format!("<string>{flag}</string>");
        let rest = &body[body.find(&tag)? + tag.len()..];
        let rest = &rest[rest.find("<string>")? + "<string>".len()..];
        Some(rest[..rest.find("</string>")?].to_string())
    };
    Some(Service { port: after("--port").and_then(|p| p.parse().ok()), host: after("--host"), file })
}

/// The installer's LaunchAgent stopped and removed: the app runs the folder's server now.
#[cfg(target_os = "macos")]
pub fn take_over(service: &Service) {
    let uid = Command::new("id").arg("-u").output().ok();
    if let Some(uid) = uid.map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()) {
        let _ = Command::new("launchctl")
            .args(["bootout", &format!("gui/{uid}/{LAUNCH_AGENT}")])
            .status();
    }
    let _ = fs::remove_file(&service.file);
}

/// The systemd user unit `install.sh` makes on Linux.
#[cfg(target_os = "linux")]
const UNIT: &str = "sprachanker.service";

/// A unit's ExecStart split as systemd does: words, a quoted one whole.
#[cfg(target_os = "linux")]
fn words(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut word = String::new();
    let mut quoted = false;
    let mut any = false;
    for c in line.chars() {
        match c {
            '"' => {
                quoted = !quoted;
                any = true;
            }
            c if c.is_whitespace() && !quoted => {
                if any {
                    out.push(std::mem::take(&mut word));
                    any = false;
                }
            }
            c => {
                word.push(c);
                any = true;
            }
        }
    }
    if any {
        out.push(word);
    }
    out
}

#[cfg(target_os = "linux")]
pub fn service(home: &Path) -> Option<Service> {
    let file = user_home().join(".config/systemd/user").join(UNIT);
    let body = fs::read_to_string(&file).ok()?;
    let exec = body.lines().find_map(|l| l.trim().strip_prefix("ExecStart="))?;
    let args = words(exec);
    let after = |flag: &str| {
        let at = args.iter().position(|a| a == flag)?;
        args.get(at + 1).cloned()
    };
    if after("--data").map(PathBuf::from).as_deref() != Some(home) {
        return None;
    }
    Some(Service { port: after("--port").and_then(|p| p.parse().ok()), host: after("--host"), file })
}

/// The installer's unit stopped, disabled and removed: the app runs the folder's server now.
#[cfg(target_os = "linux")]
pub fn take_over(service: &Service) {
    let _ = Command::new("systemctl").args(["--user", "disable", "--now", UNIT]).status();
    let _ = fs::remove_file(&service.file);
    let _ = Command::new("systemctl").args(["--user", "daemon-reload"]).status();
}

/// No installer's service on Windows: the program there is run by hand or by this app.
#[cfg(windows)]
pub fn service(_home: &Path) -> Option<Service> {
    None
}

#[cfg(windows)]
pub fn take_over(_service: &Service) {}

/// Whether `pid` is a `sprachanker` server: its program is named so (not this app,
/// `sprachanker-desktop`).
pub fn is_server(pid: u32) -> bool {
    if pid == std::process::id() {
        return false;
    }
    #[cfg(windows)]
    {
        // tasklist's CSV line: "sprachanker.exe","1234",...
        quiet(Command::new("tasklist").args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"]))
            .output()
            .is_ok_and(|o| {
                String::from_utf8_lossy(&o.stdout)
                    .trim_start()
                    .to_ascii_lowercase()
                    .starts_with(&format!("\"{SERVER}\""))
            })
    }
    #[cfg(not(windows))]
    {
        Command::new("ps").args(["-p", &pid.to_string(), "-o", "comm="]).output().is_ok_and(|o| {
            let comm = String::from_utf8_lossy(&o.stdout);
            Path::new(comm.trim()).file_name().is_some_and(|name| name.eq_ignore_ascii_case(SERVER))
        })
    }
}

/// Asks a server to stop as a service is stopped (SIGTERM: its databases closed); on Windows, which
/// has no such signal, it is ended with its engines (SQLite's journal keeps its databases whole).
pub fn terminate(pid: u32) {
    #[cfg(windows)]
    let _ = quiet(Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"])).status();
    #[cfg(not(windows))]
    let _ = Command::new("kill").args(["-TERM", &pid.to_string()]).status();
}

/// Whether this program is the installed one — only that one starts at login, not a copy run from the
/// disk image or a build folder: in Applications on a Mac, the package's on Linux, the installer's on
/// Windows (anything but a build's `target` folder).
pub fn installed() -> bool {
    let Ok(exe) = std::env::current_exe() else { return false };
    if cfg!(target_os = "macos") {
        exe.starts_with("/Applications") || exe.starts_with(user_home().join("Applications"))
    } else if cfg!(windows) {
        !exe.components().any(|c| c.as_os_str() == "target")
    } else {
        exe.starts_with("/usr")
    }
}
