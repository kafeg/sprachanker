// The phone app looked after from this Mac over adb (Wi-Fi or a cable), until the app does it
// itself: built and installed; a course of this Mac's library put on the phone (exported as a
// bundle by the `sprachanker` command, unpacked, pushed — only what the phone lacks); a course's
// AI practice brought up to date; Whisper's models put there.
//   bun scripts/phone.ts install
//   bun scripts/phone.ts course dw.nicos-weg/a1-ru --editions ru-de
//   bun scripts/phone.ts practice dw.nicos-weg/a1-ru --editions ru-de
//   bun scripts/phone.ts models
//   bun scripts/phone.ts page 'location.href' | @file.js   (an expression in the app's page, over DevTools)
// `ANDROID_SERIAL` picks the phone; `SPRACHANKER_DATA` the Mac's data root (~/SprachAnker).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

const here = join(import.meta.dir, "..");
const data = process.env.SPRACHANKER_DATA ?? join(homedir(), "SprachAnker");
const ROOT = "/sdcard/Android/data/app.sprachanker.mobile/files";
const cache = join(homedir(), ".cache", "sprachanker");

const adb = (...args: string[]) => {
  const serial = process.env.ANDROID_SERIAL;
  return execFileSync("adb", [...(serial ? ["-s", serial] : []), ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
};
const option = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

/** The SDK, the NDK and Java 17 for Tauri's Android build. */
function androidEnv() {
  const sdk = process.env.ANDROID_HOME ?? join(homedir(), "Library", "Android", "sdk");
  const ndks = join(sdk, "ndk");
  const ndk = process.env.NDK_HOME ?? join(ndks, readdirSync(ndks).sort().at(-1) ?? "");
  const java =
    process.env.JAVA_HOME ??
    execFileSync("/usr/libexec/java_home", ["-v", "17"], { encoding: "utf8" }).trim();
  const path = [
    "/opt/homebrew/opt/rustup/bin",
    join(homedir(), ".cargo", "bin"),
    process.env.PATH ?? "",
  ].join(":");
  return { ...process.env, ANDROID_HOME: sdk, NDK_HOME: ndk, JAVA_HOME: java, PATH: path };
}

async function install() {
  await $`bun scripts/build.ts`.cwd(here);
  // The page is built into the binary: cargo rebuilds it only when the Rust changes.
  await $`touch src-tauri/src/lib.rs`.cwd(here);
  await $`cargo tauri android build --debug --apk --target aarch64`.cwd(here).env(androidEnv());
  const apk = join(
    here,
    "src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk",
  );
  console.log(adb("install", "-r", apk).trim());
}

/** A course's bundle exported from this Mac's library and unpacked: its folder (the series'). */
async function unpacked(course: string, editions?: string) {
  const out = join(tmpdir(), "sprachanker-phone-course");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const cli = join(data, "bin", "sprachanker");
  await $`${cli} courses export ${course} ${editions ? ["--editions", editions] : []} --to ${out} --data ${data}`;
  const bundle = readdirSync(out).find((f) => f.endsWith(".sprachanker-course"));
  if (!bundle) throw new Error("no bundle made");
  const series = join(out, course.split("/")[0] as string);
  mkdirSync(series, { recursive: true });
  await $`unzip -q -o ${join(out, bundle)} -d ${series}`;
  rmSync(join(out, bundle));
  rmSync(join(series, "manifest.json"), { force: true });
  // The library's own index of names (the bundle carries its lines; the whole file serves).
  for (const f of ["media.json", "keys.json"]) {
    const from = join(data, "library", course.split("/")[0] as string, f);
    if (existsSync(from)) await $`cp ${from} ${join(series, f)}`;
  }
  return { out, series };
}

async function course(name: string) {
  const { out } = await unpacked(name, option("editions"));
  adb("shell", `mkdir -p ${ROOT}/library`);
  // `--sync`: only what the phone does not have the same of.
  for (const series of readdirSync(out))
    console.log(
      adb("push", "--sync", join(out, series), `${ROOT}/library/`).trim().split("\n").at(-1),
    );
  rmSync(out, { recursive: true, force: true });
}

async function practice(name: string) {
  const [series, id] = name.split("/") as [string, string];
  const editions = (option("editions") ?? "").split(",").filter(Boolean);
  const base = join(data, "library", series, "practice");
  for (const edition of editions.length ? editions : readdirSync(base)) {
    const from = join(base, edition, id);
    if (!existsSync(from)) continue;
    adb("shell", `mkdir -p ${ROOT}/library/${series}/practice/${edition}`);
    console.log(
      adb("push", "--sync", from, `${ROOT}/library/${series}/practice/${edition}/`)
        .trim()
        .split("\n")
        .at(-1),
    );
  }
}

/** Whisper's models for Android (q8_0: docs/decisions.md), made by `bun run speech:android`. */
function models() {
  adb("shell", `mkdir -p ${ROOT}/models`);
  for (const size of ["small", "base"]) {
    const file = join(cache, "models", `ggml-${size}-q8_0.bin`);
    if (!existsSync(file)) {
      console.log(`${file}: not made yet (bun run speech:android with SPEECH_MODELS=${size}-q8_0)`);
      continue;
    }
    console.log(adb("push", "--sync", file, `${ROOT}/models/`).trim().split("\n").at(-1));
  }
}

/** An expression evaluated in the app's page (its WebView's DevTools, forwarded over adb), its value
 *  printed as JSON; a promise is waited for. */
async function evaluate(expression: string) {
  const pid = adb("shell", "pidof", "app.sprachanker.mobile").trim();
  if (!pid) throw new Error("the app is not running");
  const port = 9334;
  adb("forward", `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);
  // The WebView's socket comes a moment after the app starts.
  const list = async (): Promise<unknown> => {
    for (let tries = 0; ; tries++)
      try {
        return await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      } catch (error) {
        if (tries > 20) throw error;
        await Bun.sleep(500);
      }
  };
  const pages = (await list()) as Array<{
    type: string;
    webSocketDebuggerUrl: string;
  }>;
  const page = pages.find((p) => p.type === "page");
  if (!page) throw new Error("no page in the app's WebView");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const answer = await new Promise<unknown>((resolve) => {
    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id === 1) resolve(message.result);
    };
    ws.send(
      JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    );
  });
  ws.close();
  const result = answer as { result?: { value?: unknown }; exceptionDetails?: unknown };
  console.log(JSON.stringify(result.exceptionDetails ?? result.result?.value, null, 1));
}

const [what, arg] = process.argv.slice(2);
if (what === "install") await install();
else if (what === "course" && arg) await course(arg);
else if (what === "practice" && arg) await practice(arg);
else if (what === "models") models();
else if (what === "page" && arg)
  await evaluate(arg.startsWith("@") ? await Bun.file(arg.slice(1)).text() : arg);
else {
  console.log(
    "bun scripts/phone.ts install | course <series/course> [--editions e] | practice <series/course> [--editions e] | models | page <expression>",
  );
  process.exit(1);
}
