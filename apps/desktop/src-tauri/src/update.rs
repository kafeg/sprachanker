// The app updated from its own page (Settings → About, `install_update`; capabilities/update.json lets
// only the page of its own server ask): Tauri's updater reads the latest release's latest.json on
// GitHub over HTTPS, takes only a later version, downloads the file for this system and checks it
// against the minisign key in tauri.conf.json — and the version it was signed for — before it is
// installed; then the app starts again.
use std::sync::Arc;

use tauri::{AppHandle, Manager};
use tauri_plugin_updater::UpdaterExt;

use crate::Server;

/// A step that failed: said on the app's stderr and to the page.
fn failed(step: &str, error: impl std::fmt::Display) -> String {
    let said = format!("{step}: {error}");
    eprintln!("the update: {said}");
    said
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let update = app
        .updater()
        .map_err(|e| failed("the updater", e))?
        .check()
        .await
        .map_err(|e| failed("checking", e))?
        .ok_or_else(|| failed("checking", "no newer version"))?;
    let bytes = update.download(|_, _| {}, || {}).await.map_err(|e| failed("downloading", e))?;
    // Windows replaces no program while it runs: the server and its engines go first, and the
    // installer it starts ends this app; elsewhere the app is replaced in place, then started again.
    if cfg!(windows) {
        app.state::<Arc<Server>>().stop();
    }
    if let Err(error) = update.install(bytes) {
        let said = failed("installing", error);
        if cfg!(windows) {
            // Its server stopped: the app starts again with it.
            app.restart();
        }
        return Err(said);
    }
    app.restart();
}
