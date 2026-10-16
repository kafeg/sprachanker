// The app's build: Tauri's, and on Android and iOS the whisper.cpp shim (native/asr.c) over the
// static libraries of the version in native/whisper/VERSION, the server's
// (`SPRACHANKER_WHISPER_CPP`: its sources' folder, ~/.cache/sprachanker/whisper.cpp-<version>
// otherwise): built with the NDK by `bun run speech:android` (build-android-arm64), for iOS with
// Metal (build-ios-sim, build-ios: apps/mobile/CLAUDE.md); on Android the reading-aloud engines packed.
use std::path::PathBuf;

fn main() {
    tauri_build::build();
    let os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target = std::env::var("TARGET").unwrap_or_default();
    if target == "aarch64-linux-android" {
        engines();
    }
    let build = match os.as_str() {
        "android" => "build-android-arm64",
        "ios" if target.ends_with("-sim") => "build-ios-sim",
        "ios" => "build-ios",
        _ => return,
    };
    let version = std::fs::read_to_string("../../../native/whisper/VERSION").unwrap();
    let src = std::env::var("SPRACHANKER_WHISPER_CPP").map(PathBuf::from).unwrap_or_else(|_| {
        PathBuf::from(std::env::var("HOME").unwrap())
            .join(".cache/sprachanker")
            .join(format!("whisper.cpp-{}", version.trim()))
    });
    let build = src.join(build);
    cc::Build::new()
        .file("native/asr.c")
        .include(src.join("include"))
        .include(src.join("ggml/include"))
        .compile("sa_asr");
    for dir in ["src", "ggml/src", "ggml/src/ggml-metal"] {
        println!("cargo:rustc-link-search=native={}", build.join(dir).display());
    }
    for lib in ["whisper", "ggml", "ggml-cpu", "ggml-base"] {
        println!("cargo:rustc-link-lib=static={lib}");
    }
    if os == "ios" {
        println!("cargo:rustc-link-lib=static=ggml-metal");
        for framework in ["Metal", "MetalKit", "Foundation", "Accelerate"] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
        println!("cargo:rustc-link-lib=c++");
    } else {
        println!("cargo:rustc-link-lib=c++_static");
        println!("cargo:rustc-link-lib=c++abi");
    }
    println!("cargo:rerun-if-changed=native/asr.c");
    println!("cargo:rerun-if-changed=build.rs");
}

/// Reading aloud's engines built for the phone (`bun native/scripts/build.ts android`) packed beside
/// the app's library as `libsa_<engine>.so` — Android installs what is there into the one folder an
/// app may run programs from (src/engines.rs); one not built is left out (the app says so).
fn engines() {
    let libs = PathBuf::from("gen/android/app/src/main/jniLibs/arm64-v8a");
    for (engine, program) in [("piper", "sherpa-onnx-offline-tts"), ("qwen", "tts-server")] {
        let built =
            PathBuf::from(format!("../../../native/{engine}/out/{program}-aarch64-linux-android"));
        let packed = libs.join(format!("libsa_{engine}.so"));
        println!("cargo:rerun-if-changed={}", built.display());
        if built.exists() {
            std::fs::create_dir_all(&libs).unwrap();
            std::fs::copy(&built, &packed).unwrap();
        } else {
            let _ = std::fs::remove_file(&packed);
            println!("cargo:warning={engine}: not built for Android (bun native/scripts/build.ts android)");
        }
    }
}
