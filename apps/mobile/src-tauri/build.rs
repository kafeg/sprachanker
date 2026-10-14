// The app's build: Tauri's, and on Android the whisper.cpp shim (native/asr.c) over the static
// libraries `bun run speech:android` builds with the NDK — the version in native/whisper/VERSION, the
// server's (`SPRACHANKER_WHISPER_CPP`: its sources' folder, ~/.cache/sprachanker/whisper.cpp-<version>
// otherwise).
use std::path::PathBuf;

fn main() {
    tauri_build::build();
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("android") {
        return;
    }
    let version = std::fs::read_to_string("../../../native/whisper/VERSION").unwrap();
    let src = std::env::var("SPRACHANKER_WHISPER_CPP").map(PathBuf::from).unwrap_or_else(|_| {
        PathBuf::from(std::env::var("HOME").unwrap())
            .join(".cache/sprachanker")
            .join(format!("whisper.cpp-{}", version.trim()))
    });
    let build = src.join("build-android-arm64");
    cc::Build::new()
        .file("native/asr.c")
        .include(src.join("include"))
        .include(src.join("ggml/include"))
        .compile("sa_asr");
    for dir in ["src", "ggml/src"] {
        println!("cargo:rustc-link-search=native={}", build.join(dir).display());
    }
    for lib in ["whisper", "ggml", "ggml-cpu", "ggml-base"] {
        println!("cargo:rustc-link-lib=static={lib}");
    }
    println!("cargo:rustc-link-lib=c++_static");
    println!("cargo:rustc-link-lib=c++abi");
    println!("cargo:rerun-if-changed=native/asr.c");
    println!("cargo:rerun-if-changed=build.rs");
}
