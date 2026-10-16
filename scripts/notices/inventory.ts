// What the builds carry that no lockfile names: the speech engines and what each links, the runtime
// compiled into the program, the phone app's Android libraries, and what the app downloads when the
// learner chooses it. Each entry is pinned to what the repository builds — notices.test.ts fails
// when a pinned version (native/<engine>/VERSION, Bun's, a Gradle library's) moves without it.
// Licence texts are the components' own, copied into texts/ from their sources at these versions;
// spdx-<id>.txt are the standard texts (spdx/license-list-data) for those that ship none.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The builds given out: the program's archive (the program and the speech engines), the Mac app
 *  (the same program and engines inside), the Android app. */
export const BUILDS = ["program", "mac", "android"] as const;
export type Build = (typeof BUILDS)[number];

export type Group = "native" | "runtime" | "js" | "rust" | "android" | "download";

export interface Component {
  group: Group;
  name: string;
  version: string;
  /** SPDX expression, or the licence's name as its authors give it. */
  licence: string;
  copyright?: string;
  /** Where the exact source of this version is. */
  source: string;
  builds: Build[];
  /** Where it is in the builds (a program it is linked into). */
  where?: string;
  /** The engine (packages/server's ENGINES) this entry pins: its version is that engine's VERSION. */
  engine?: "whisper" | "piper" | "qwen";
  note?: string;
  /** Licence texts, whole. */
  texts: string[];
}

const TEXTS = join(import.meta.dir, "texts");

/** A licence text kept in texts/. */
export const text = (id: string) => readFileSync(join(TEXTS, `${id}.txt`), "utf8");

/** A standard licence text without its template's copyright line (the entry names the holders). */
export function spdx(id: string) {
  return text(`spdx-${id}`)
    .split("\n")
    .filter((line) => !/<(year|owner|copyright holders?)>/i.test(line))
    .join("\n");
}

const ALL: Build[] = ["program", "mac", "android"];
const COMPUTER: Build[] = ["program", "mac"];

// whisper.cpp — the program's whisper-server; on Android linked into the app (asr.c).
const WHISPER = "v1.9.5";
const WHISPER_SRC = `https://github.com/ggml-org/whisper.cpp/tree/${WHISPER}`;
// sherpa-onnx — Piper's voices read by its sherpa-onnx-offline-tts, which links eSpeak NG (GPL).
const SHERPA = "v1.13.8";
const SHERPA_SRC = `https://github.com/k2-fsa/sherpa-onnx/tree/${SHERPA}`;
const IN_SHERPA = "sherpa-onnx-offline-tts (on Android: lib/arm64-v8a/libsa_piper.so)";
// qwentts.cpp — Qwen3-TTS's tts-server; pinned by commit.
const QWEN = "51512f129a7419567f4b8abfb06801451789b8f1";
const IN_QWEN = "tts-server (on Android: lib/arm64-v8a/libsa_qwen.so)";
const ONNX_RUNTIME = "1.28.2";

export const NATIVE: Component[] = [
  {
    group: "native",
    name: "whisper.cpp",
    version: WHISPER,
    engine: "whisper",
    licence: "MIT",
    copyright: "Copyright (c) 2023-2026 The ggml authors",
    source: WHISPER_SRC,
    builds: ALL,
    where:
      "whisper-server; on Android linked into the app (lib/arm64-v8a/libsprachanker_mobile_lib.so)",
    texts: [text("whisper.cpp")],
  },
  {
    group: "native",
    name: "ggml (in whisper.cpp)",
    version: `0.26.0, whisper.cpp ${WHISPER}`,
    licence: "MIT",
    copyright: "Copyright (c) 2023-2026 The ggml authors",
    source: `${WHISPER_SRC}/ggml`,
    builds: ALL,
    where: "whisper-server; the Android app",
    texts: [text("whisper.cpp")],
  },
  {
    group: "native",
    name: "cpp-httplib (in whisper.cpp)",
    version: "0.20.0",
    licence: "MIT",
    copyright: "Copyright (c) 2025 Yuji Hirose",
    source: `${WHISPER_SRC}/examples/server/httplib.h`,
    builds: COMPUTER,
    where: "whisper-server",
    texts: [spdx("MIT")],
  },
  {
    group: "native",
    name: "JSON for Modern C++ (in whisper.cpp)",
    version: "3.11.2",
    licence: "MIT",
    copyright: "Copyright (c) 2013-2022 Niels Lohmann",
    source: `${WHISPER_SRC}/examples/json.hpp`,
    builds: COMPUTER,
    where: "whisper-server",
    texts: [spdx("MIT")],
  },
  {
    group: "native",
    name: "miniaudio (in whisper.cpp)",
    version: "0.11.24",
    licence: "Unlicense OR MIT-0",
    copyright: "Copyright 2025 David Reid",
    source: `${WHISPER_SRC}/examples/miniaudio.h`,
    builds: COMPUTER,
    where: "whisper-server",
    texts: [spdx("MIT-0")],
  },
  {
    group: "native",
    name: "stb_vorbis (in whisper.cpp)",
    version: "1.22",
    licence: "MIT OR Unlicense",
    copyright: "Copyright (c) 2017 Sean Barrett",
    source: `${WHISPER_SRC}/examples/stb_vorbis.c`,
    builds: COMPUTER,
    where: "whisper-server",
    texts: [spdx("MIT")],
  },
  {
    group: "native",
    name: "sherpa-onnx",
    version: SHERPA,
    engine: "piper",
    licence: "Apache-2.0",
    copyright: "Copyright (c) Xiaomi Corporation and the k2-fsa authors",
    source: SHERPA_SRC,
    builds: ALL,
    where: IN_SHERPA,
    note: "Linked with eSpeak NG (GPL-3.0-or-later): this program as a whole is under the GPL — see “Source code for the GPL and LGPL components” above.",
    texts: [text("sherpa-onnx")],
  },
  {
    group: "native",
    name: "eSpeak NG (sherpa-onnx's fork)",
    version: "1.52.0.1, commit ed530aa113046142eb5115cf2fc9157854d0ffe1",
    licence: "GPL-3.0-or-later (getopt.c: BSD-2-Clause; Unicode data: Unicode-DFS)",
    copyright:
      "Copyright (C) 2005-2017 Jonathan Duddington, Reece H. Dunn and the eSpeak NG contributors",
    source: "https://github.com/csukuangfj/espeak-ng/tree/ed530aa113046142eb5115cf2fc9157854d0ffe1",
    builds: ALL,
    where: IN_SHERPA,
    note: "Includes ucd-tools (GPL-3.0-or-later). Its source is at the link; see “Source code for the GPL and LGPL components” above.",
    texts: [
      text("espeak-ng"),
      text("espeak-ng-bsd2"),
      text("espeak-ng-apache"),
      text("espeak-ng-ucd"),
    ],
  },
  {
    group: "native",
    name: "piper-phonemize (sherpa-onnx's fork)",
    version: "commit f3ff95afc03640bc1399e113e83361192a2fafb4",
    licence: "MIT",
    copyright: "Copyright (c) 2023 Michael Hansen",
    source:
      "https://github.com/csukuangfj/piper-phonemize/tree/f3ff95afc03640bc1399e113e83361192a2fafb4",
    builds: ALL,
    where: IN_SHERPA,
    texts: [text("piper-phonemize")],
  },
  {
    group: "native",
    name: "uni-algo (in piper-phonemize)",
    version: "piper-phonemize f3ff95a",
    licence: "Unlicense OR MIT",
    source:
      "https://github.com/csukuangfj/piper-phonemize/tree/f3ff95afc03640bc1399e113e83361192a2fafb4/licenses/uni-algo",
    builds: ALL,
    where: IN_SHERPA,
    texts: [text("uni-algo")],
  },
  {
    group: "native",
    name: "ONNX Runtime (static library)",
    version: ONNX_RUNTIME,
    licence: "MIT",
    copyright: "Copyright (c) Microsoft Corporation",
    source: `https://github.com/microsoft/onnxruntime/tree/v${ONNX_RUNTIME}`,
    builds: ALL,
    where: IN_SHERPA,
    note: `Built by https://github.com/csukuangfj/onnxruntime-libs/releases/tag/v${ONNX_RUNTIME} (osx-arm64 and android-arm64-v8a static libraries). Its third-party notices follow its licence.`,
    texts: [text("onnxruntime"), text("onnxruntime-third-party")],
  },
  {
    group: "native",
    name: "kaldi-native-fbank",
    version: "1.22.3",
    licence: "Apache-2.0",
    source: "https://github.com/csukuangfj/kaldi-native-fbank/tree/v1.22.3",
    builds: ALL,
    where: IN_SHERPA,
    texts: [text("kaldi-native-fbank")],
  },
  {
    group: "native",
    name: "KISS FFT (in kaldi-native-fbank)",
    version: "commit febd4caeed32e33ad8b2e0bb5ea77542c40f18ec",
    licence: "BSD-3-Clause",
    copyright: "Copyright (c) 2003-2010 Mark Borgerding",
    source: "https://github.com/mborgerding/kissfft/tree/febd4caeed32e33ad8b2e0bb5ea77542c40f18ec",
    builds: ALL,
    where: IN_SHERPA,
    texts: [text("kissfft")],
  },
  {
    group: "native",
    name: "kaldi-decoder",
    version: "0.3.0",
    licence: "Apache-2.0",
    source: "https://github.com/k2-fsa/kaldi-decoder/tree/v0.3.0",
    builds: ALL,
    where: IN_SHERPA,
    texts: [text("kaldi-decoder")],
  },
  {
    group: "native",
    name: "kaldifst",
    version: "1.8.0",
    licence: "Apache-2.0",
    source: "https://github.com/k2-fsa/kaldifst/tree/v1.8.0",
    builds: ALL,
    where: IN_SHERPA,
    texts: [text("kaldifst")],
  },
  {
    group: "native",
    name: "OpenFst (sherpa-onnx's fork)",
    version: "1.8.5-2026-07-09",
    licence: "Apache-2.0",
    copyright: "Copyright 2005-2026 Google LLC",
    source: "https://github.com/csukuangfj/openfst/tree/v1.8.5-2026-07-09",
    builds: ALL,
    where: IN_SHERPA,
    texts: [text("openfst")],
  },
  {
    group: "native",
    name: "simple-sentencepiece",
    version: "0.7",
    licence: "Apache-2.0",
    source: "https://github.com/pkufool/simple-sentencepiece/tree/v0.7",
    builds: ALL,
    where: IN_SHERPA,
    texts: [text("simple-sentencepiece")],
  },
  {
    group: "native",
    name: "Eigen",
    version: "5.0.1",
    licence: "MPL-2.0",
    source: "https://gitlab.com/libeigen/eigen/-/tree/5.0.1",
    builds: ALL,
    where: IN_SHERPA,
    texts: [text("eigen")],
  },
  {
    group: "native",
    name: "JSON for Modern C++ (in sherpa-onnx)",
    version: "3.12.0",
    licence: "MIT",
    source: "https://github.com/nlohmann/json/tree/v3.12.0",
    builds: ALL,
    where: IN_SHERPA,
    texts: [text("nlohmann-json")],
  },
  {
    group: "native",
    name: "qwentts.cpp",
    version: QWEN,
    engine: "qwen",
    licence: "MIT",
    copyright: "Copyright (c) 2023-2026 The omnivoice.cpp authors",
    source: `https://github.com/ServeurpersoCom/qwentts.cpp/tree/${QWEN}`,
    builds: ALL,
    where: IN_QWEN,
    texts: [text("qwentts.cpp")],
  },
  {
    group: "native",
    name: "ggml (qwentts.cpp's fork)",
    version: "0.26.0, commit 2eddaf94a8cdbbf1c30017d28313cd661a9da543",
    licence: "MIT",
    copyright: "Copyright (c) 2023-2026 The ggml authors",
    source: "https://github.com/ServeurpersoCom/ggml/tree/2eddaf94a8cdbbf1c30017d28313cd661a9da543",
    builds: ALL,
    where: IN_QWEN,
    texts: [text("whisper.cpp")],
  },
  {
    group: "native",
    name: "cpp-httplib (in qwentts.cpp)",
    version: "0.46.1",
    licence: "MIT",
    copyright: "Copyright (c) 2017 yhirose",
    source: `https://github.com/ServeurpersoCom/qwentts.cpp/tree/${QWEN}/vendor/cpp-httplib`,
    builds: ALL,
    where: IN_QWEN,
    texts: [text("cpp-httplib")],
  },
  {
    group: "native",
    name: "yyjson (in qwentts.cpp)",
    version: "0.12.0",
    licence: "MIT",
    copyright: "Copyright (c) 2020 YaoYuan <ibireme@gmail.com>",
    source: `https://github.com/ServeurpersoCom/qwentts.cpp/tree/${QWEN}/vendor/yyjson`,
    builds: ALL,
    where: IN_QWEN,
    texts: [spdx("MIT")],
  },
  {
    group: "native",
    name: "LLVM libc++ (the Android NDK's)",
    version: "Android NDK r27d (27.3.13750724), clang 18.0.4",
    licence: "Apache-2.0 WITH LLVM-exception (older parts: NCSA)",
    copyright: "The LLVM Project",
    source:
      "https://android.googlesource.com/toolchain/llvm-project/+/d8003a456d14a3deb8054cdaa529ffbf02d9b262/libcxx",
    builds: ["android"],
    where: "linked statically into the engines and the app's library",
    texts: [text("libcxx")],
  },
];

/** What Bun links, with its parts' texts: bun.json, written by bun.ts for the Bun release
 *  package.json pins (absent: none, and check.ts says Bun's version does not match). */
const BUN_PARTS = join(import.meta.dir, "bun.json");
const bunParts = (
  existsSync(BUN_PARTS)
    ? JSON.parse(readFileSync(BUN_PARTS, "utf8"))
    : { bun: "", parts: [], texts: [] }
) as {
  bun: string;
  parts: Array<Omit<Component, "group" | "builds" | "texts"> & { texts: number[] }>;
  texts: string[];
};

export const RUNTIME: Component[] = [
  {
    group: "runtime",
    name: "Bun",
    version: bunParts.bun,
    licence: "MIT (statically links LGPL-2.0 JavaScriptCore/WebKit and LGPL-2.1 TinyCC)",
    copyright: "Copyright (c) Oven and the Bun contributors",
    source: `https://github.com/oven-sh/bun/tree/bun-v${bunParts.bun}`,
    builds: COMPUTER,
    where: "the sprachanker program (bun build --compile)",
    note: "Bun's own statement of what it links follows; each part is listed below with its texts. On macOS Bun uses the system's SQLite and ICU.",
    texts: [text("bun"), spdx("MIT")],
  },
  ...bunParts.parts.map(
    (part): Component => ({
      ...part,
      group: "runtime",
      builds: COMPUTER,
      where: "the sprachanker program, in Bun",
      texts: part.texts.map((i) => bunParts.texts[i] as string),
    }),
  ),
];

/** The phone app's Android libraries, as Gradle resolves the release build's runtime classpath
 *  (`declared`: written in gen/android/app/build.gradle.kts; the rest come with them). */
const AOSP = "Copyright The Android Open Source Project";
const JACKSON = "Copyright 2007- Tatu Saloranta and the Jackson contributors (FasterXML)";
const KOTLIN = "Copyright JetBrains s.r.o. and Kotlin Programming Language contributors";
const androidx = (ids: string[]) => ids.map((id) => ({ id: `androidx.${id}`, copyright: AOSP }));
const ANDROID_LIBS: Array<{ id: string; declared?: true; copyright: string; texts?: string[] }> = [
  { id: "androidx.activity:activity-ktx:1.10.1", declared: true, copyright: AOSP },
  { id: "androidx.appcompat:appcompat:1.7.1", declared: true, copyright: AOSP },
  { id: "androidx.lifecycle:lifecycle-process:2.10.0", declared: true, copyright: AOSP },
  { id: "androidx.webkit:webkit:1.14.0", declared: true, copyright: AOSP },
  { id: "com.google.android.material:material:1.12.0", declared: true, copyright: AOSP },
  ...androidx([
    "activity:activity:1.10.1",
    "annotation:annotation-experimental:1.4.1",
    "annotation:annotation-jvm:1.9.1",
    "annotation:annotation:1.9.1",
    "appcompat:appcompat-resources:1.7.1",
    "arch.core:core-common:2.2.0",
    "arch.core:core-runtime:2.2.0",
    "cardview:cardview:1.0.0",
    "collection:collection:1.1.0",
    "concurrent:concurrent-futures:1.1.0",
    "constraintlayout:constraintlayout-solver:2.0.1",
    "constraintlayout:constraintlayout:2.0.1",
    "coordinatorlayout:coordinatorlayout:1.1.0",
    "core:core-ktx:1.13.1",
    "core:core-viewtree:1.0.0",
    "core:core:1.13.1",
    "cursoradapter:cursoradapter:1.0.0",
    "customview:customview:1.1.0",
    "documentfile:documentfile:1.0.0",
    "drawerlayout:drawerlayout:1.1.1",
    "dynamicanimation:dynamicanimation:1.0.0",
    "emoji2:emoji2-views-helper:1.3.0",
    "emoji2:emoji2:1.3.0",
    "fragment:fragment:1.5.4",
    "interpolator:interpolator:1.0.0",
    "legacy:legacy-support-core-utils:1.0.0",
    "lifecycle:lifecycle-common-jvm:2.10.0",
    "lifecycle:lifecycle-common:2.10.0",
    "lifecycle:lifecycle-livedata-core-ktx:2.10.0",
    "lifecycle:lifecycle-livedata-core:2.10.0",
    "lifecycle:lifecycle-livedata:2.10.0",
    "lifecycle:lifecycle-runtime-android:2.10.0",
    "lifecycle:lifecycle-runtime-ktx-android:2.10.0",
    "lifecycle:lifecycle-runtime-ktx:2.10.0",
    "lifecycle:lifecycle-runtime:2.10.0",
    "lifecycle:lifecycle-viewmodel-android:2.10.0",
    "lifecycle:lifecycle-viewmodel-ktx:2.10.0",
    "lifecycle:lifecycle-viewmodel-savedstate-android:2.10.0",
    "lifecycle:lifecycle-viewmodel-savedstate:2.10.0",
    "lifecycle:lifecycle-viewmodel:2.10.0",
    "loader:loader:1.0.0",
    "localbroadcastmanager:localbroadcastmanager:1.0.0",
    "print:print:1.0.0",
    "profileinstaller:profileinstaller:1.4.0",
    "recyclerview:recyclerview:1.1.0",
    "resourceinspection:resourceinspection-annotation:1.0.1",
    "savedstate:savedstate-android:1.4.0",
    "savedstate:savedstate-ktx:1.4.0",
    "savedstate:savedstate:1.4.0",
    "startup:startup-runtime:1.1.1",
    "tracing:tracing:1.0.0",
    "transition:transition:1.5.0",
    "vectordrawable:vectordrawable-animated:1.1.0",
    "vectordrawable:vectordrawable:1.1.0",
    "versionedparcelable:versionedparcelable:1.1.1",
    "viewpager2:viewpager2:1.0.0",
    "viewpager:viewpager:1.0.0",
  ]),
  // Tauri's Android library (in the tauri crate) brings these.
  {
    id: "com.fasterxml.jackson.core:jackson-annotations:2.15.3",
    copyright: JACKSON,
    texts: [text("jackson-annotations-notice")],
  },
  {
    id: "com.fasterxml.jackson.core:jackson-core:2.15.3",
    copyright: `${JACKSON}; FastDoubleParser: Copyright © 2023 Werner Randelshofer (MIT); bigint: Copyright 2022 Tim Buktu (BSD-2-Clause)`,
    texts: [
      text("jackson-core-notice"),
      text("fastdoubleparser-notice"),
      spdx("MIT"),
      text("bigint"),
    ],
  },
  {
    id: "com.fasterxml.jackson.core:jackson-databind:2.15.3",
    copyright: JACKSON,
    texts: [text("jackson-databind-notice")],
  },
  {
    id: "com.fasterxml.jackson.datatype:jackson-datatype-json-org:2.15.3",
    copyright: JACKSON,
    texts: [text("jackson-json-org"), text("jackson-json-org-notice")],
  },
  {
    id: "com.google.errorprone:error_prone_annotations:2.15.0",
    copyright: "Copyright The Error Prone Authors",
  },
  { id: "com.google.guava:listenablefuture:1.0", copyright: "Copyright The Guava Authors" },
  { id: "org.jetbrains.kotlin:kotlin-stdlib:2.2.10", copyright: KOTLIN },
  { id: "org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0", copyright: KOTLIN },
  { id: "org.jetbrains.kotlinx:kotlinx-coroutines-core-jvm:1.9.0", copyright: KOTLIN },
  { id: "org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0", copyright: KOTLIN },
  { id: "org.jetbrains.kotlinx:kotlinx-serialization-core-jvm:1.7.3", copyright: KOTLIN },
  { id: "org.jetbrains.kotlinx:kotlinx-serialization-core:1.7.3", copyright: KOTLIN },
  { id: "org.jetbrains:annotations:23.0.0", copyright: "Copyright JetBrains s.r.o." },
  { id: "org.jspecify:jspecify:1.0.0", copyright: "Copyright The JSpecify Authors" },
];

export const ANDROID: Component[] = ANDROID_LIBS.map(({ id, copyright, texts = [] }) => {
  const [group, artifact, version] = id.split(":") as [string, string, string];
  return {
    group: "android",
    name: `${group}:${artifact}`,
    version,
    licence: "Apache-2.0",
    copyright,
    source: /^(androidx|com\.google\.android)\./.test(group)
      ? `https://maven.google.com/web/index.html#${group}:${artifact}:${version}`
      : `https://central.sonatype.com/artifact/${group}/${artifact}/${version}`,
    builds: ["android"],
    texts: [spdx("Apache-2.0"), ...texts],
  };
});

/** The libraries written in the Android app's Gradle build, with their versions. */
export const ANDROID_DECLARED = ANDROID_LIBS.filter((l) => l.declared).map((l) => l.id);

/** The tauri crate the list above was resolved with (its Android library brings Jackson and
 *  Kotlin's): another one in apps/mobile's Cargo.lock means resolving the list again —
 *  `./gradlew :app:dependencies --configuration universalReleaseRuntimeClasspath` in gen/android. */
export const ANDROID_RESOLVED_WITH_TAURI = "2.12.1";

export const SOURCE_OFFER = [
  "Source code for the GPL and LGPL components",
  "",
  "sherpa-onnx-offline-tts (beside the program, in SprachAnker.app/Contents/MacOS, and in the",
  "Android app as lib/arm64-v8a/libsa_piper.so) links eSpeak NG, which is under the GNU General",
  "Public License version 3 or later; so that program as a whole is under the GPL. SprachAnker",
  "starts it as a separate program and is itself under the MIT licence. Its complete corresponding",
  "source is: sherpa-onnx at the version below with the sources its build fetches, each listed",
  "below with the link to its exact version; ONNX Runtime's source at its version and the recipe its",
  "static libraries were built by (https://github.com/csukuangfj/onnxruntime-build, as of their",
  `release v${ONNX_RUNTIME}); and the script that builds the program, native/scripts/build.ts in`,
  "SprachAnker's repository at the version of your build:",
  "https://github.com/kafeg/sprachanker (tag v<version>; the version is in Settings → About).",
  "",
  `The program (sprachanker) is compiled with Bun ${bunParts.bun}, which statically links`,
  "JavaScriptCore and WTF from WebKit (GNU Library GPL version 2 or later) and TinyCC (GNU Lesser",
  "GPL version 2.1 or later). Their copyright holders and sources are in their entries below.",
  "To relink the program with a changed library: build Bun from its source with that library",
  "(Bun's statement below says how), then build the program from SprachAnker's source at your",
  "version with that Bun (`bun run build:bin`).",
  "",
  "Written offer: for three years after we last gave out a build, anyone may ask for the complete",
  "corresponding source of these GPL and LGPL components as built into it, by opening an issue at",
  "https://github.com/kafeg/sprachanker/issues; we provide it at no more than the cost of",
  "physically performing the transfer.",
].join("\n");
