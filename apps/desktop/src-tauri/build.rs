// Tauri's build — the app's one command (`install_update`) named, so that capabilities/ decide who
// may call it —, and the shell's few words (the tray's, a failure's) taken from the web app's
// catalogs — their `desktop` section in every language — into strings.json, which main.rs embeds.
use std::{collections::BTreeMap, fs, path::Path};

fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["install_update"]),
    ))
    .expect("Tauri's build");
    let dir = Path::new("../../web/src/i18n");
    println!("cargo:rerun-if-changed={}", dir.display());
    let mut strings = BTreeMap::new();
    for entry in fs::read_dir(dir).expect("the web app's catalogs") {
        let path = entry.unwrap().path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let catalog: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        if let Some(desktop) = catalog.get("desktop") {
            let code = path.file_stem().unwrap().to_string_lossy().to_string();
            strings.insert(code, desktop.clone());
        }
    }
    let out = Path::new(&std::env::var("OUT_DIR").unwrap()).join("strings.json");
    fs::write(out, serde_json::to_string(&strings).unwrap()).unwrap();
}
