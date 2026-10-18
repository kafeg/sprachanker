// Whisper on an Android phone as an app would run it: whisper.cpp's whisper-server built for the
// phone (the version in native/whisper/VERSION, arm64 with dot product and fp16, the NDK's
// toolchain), started over adb with a model loaded once, then the phrases (phrases.ts: read by
// Qwen3-TTS, heard by this Mac for comparison) sent one by one and timed — models tiny, base and
// small (q5_1), with as many threads as the phone has fast cores (`SPEECH_THREADS`, e.g. "4,8") and
// Whisper's whole 30-second window (`SPEECH_WINDOWS=full,fitted` adds one fitted to the answer,
// `audio_ctx`). Times are the request's, over adb (Wi-Fi or a cable); an answer taking longer than
// two minutes counts as failed. Results in the root's results.json and results.md, written as they
// come. `bun run speech:android` (`ANDROID_SERIAL` picks the phone).
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { checkRoot } from "./app.ts";
import { heard, type Phrase, readPhrases } from "./phrases.ts";

const ROOT = checkRoot("sprachanker-speech-android");
const APP_PORT = 4596;
const PHONE_PORT = 8178;
const DIR = "/data/local/tmp/sprachanker-whisper";
const cache = join(homedir(), ".cache", "sprachanker");
const version = readFileSync(
  new URL("../../native/whisper/VERSION", import.meta.url),
  "utf8",
).trim();
// Models by size and format (q5_1 unless named: "small-q4_0").
const MODELS = (process.env.SPEECH_MODELS ?? "tiny,base,small").split(",");
// On a phone of big and little cores, threads beyond the big ones wait for the little (a Snapdragon
// 860's 8 threads: 3–30 times slower than its 4).
const THREADS = (process.env.SPEECH_THREADS ?? "4").split(",").map(Number);
const WINDOWS = (process.env.SPEECH_WINDOWS ?? "full").split(",") as Array<"full" | "fitted">;
const ANSWER_MS = 120_000;

const adb = (...args: string[]) => {
  const serial = process.env.ANDROID_SERIAL;
  return execFileSync("adb", [...(serial ? ["-s", serial] : []), ...args], { encoding: "utf8" });
};

/** whisper-server for the phone: the app's whisper.cpp built with the NDK (native/scripts/build.ts
 *  android whisper — the static libraries the phone app links, and this program). */
function phoneServer() {
  const out = join(
    import.meta.dirname,
    "../../native/whisper/out/whisper-server-aarch64-linux-android",
  );
  if (!existsSync(out))
    execFileSync(
      "bun",
      [join(import.meta.dirname, "../../native/scripts/build.ts"), "android", "whisper"],
      {
        stdio: "inherit",
      },
    );
  return out;
}

/** A model's file ("small", q5_1, or "small-q4_0"): this Mac's (small q5_1, the app's), else in the
 *  cache — downloaded once, or quantized there from the f16 model by whisper.cpp's whisper-quantize
 *  (the formats whisper.cpp does not publish). */
async function model(name: string) {
  const [size, quant = "q5_1"] = name.split("-");
  const file = `ggml-${size}-${quant}.bin`;
  const mac = join(
    process.env.SPRACHANKER_MODELS ?? join(homedir(), "SprachAnker", "models"),
    file,
  );
  if (existsSync(mac)) return mac;
  const dir = join(cache, "models");
  mkdirSync(dir, { recursive: true });
  const fetched = async (f: string) => {
    const path = join(dir, f);
    if (existsSync(path)) return path;
    const res = await fetch(`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${f}`);
    if (!res.ok) return undefined;
    writeFileSync(path, new Uint8Array(await res.arrayBuffer()));
    return path;
  };
  const got = await fetched(file);
  if (got) return got;
  const f16 = await fetched(`ggml-${size}.bin`);
  const quantize = join(cache, `whisper.cpp-${version}`, "build", "bin", "whisper-quantize");
  if (!f16) throw new Error(`no ${file} and no ggml-${size}.bin to make it from`);
  if (!existsSync(quantize))
    execFileSync("cmake", [
      "--build",
      join(cache, `whisper.cpp-${version}`, "build"),
      "--target",
      "whisper-quantize",
    ]);
  execFileSync(quantize, [f16, join(dir, file), quant], { stdio: "ignore" });
  return join(dir, file);
}

/** A file on the phone, pushed unless one of its size is there. */
function push(path: string) {
  const name = path.split("/").at(-1) as string;
  const there = adb("shell", `stat -c %s ${DIR}/${name} 2>/dev/null || echo 0`).trim();
  if (Number(there) !== statSync(path).size) adb("push", path, `${DIR}/${name}`);
  return `${DIR}/${name}`;
}

/** What the phone's server heard in a WAV, and how long the request took. */
async function hear(wav: Uint8Array<ArrayBuffer>, audioCtx: number) {
  const form = new FormData();
  form.set("file", new Blob([wav], { type: "audio/wav" }), "speech.wav");
  form.set("language", "de");
  form.set("response_format", "json");
  form.set("temperature", "0");
  form.set("no_language_probabilities", "true");
  if (audioCtx) form.set("audio_ctx", String(audioCtx));
  const t0 = performance.now();
  try {
    const res = await fetch(`http://127.0.0.1:${PHONE_PORT}/inference`, {
      signal: AbortSignal.timeout(ANSWER_MS),
      method: "POST",
      body: form,
    });
    const text = ((await res.json()) as { text?: string }).text?.trim() ?? "";
    return { ms: Math.round(performance.now() - t0), text };
  } catch {
    return { ms: Math.round(performance.now() - t0), text: "", failed: true };
  }
}

/** Whisper's window fitted to an answer: 50 frames a second, a second to spare. */
const fitted = (seconds: number) => Math.min(1500, Math.ceil((seconds + 1) * 50));

const phone = adb(
  "shell",
  "echo $(getprop ro.product.manufacturer) $(getprop ro.product.model), Android $(getprop ro.build.version.release), $(getprop ro.board.platform)",
).trim();
adb("shell", `mkdir -p ${DIR}`);
const binary = push(phoneServer());
const models = new Map<string, string>();
for (const m of MODELS) models.set(m, push(await model(m)));
const { phrases, wavs } = await readPhrases(ROOT, APP_PORT);

interface Row {
  model: string;
  threads: number;
  window: "full" | "fitted";
  loadMs: number;
  heard: Array<{ id: string; ms: number; text: string; heard: number }>;
}
const rows: Row[] = [];
/** The comparison as a table: a phrase a line, a setup a column (ms · share of words heard). */
function table(phrases: Phrase[], rows: Row[]) {
  const head = [
    "phrase",
    "s",
    "Mac small",
    ...rows.map((r) => `${r.model} ${r.threads}t ${r.window}`),
  ];
  const lines = [head, head.map(() => "---")];
  for (const p of phrases)
    lines.push([
      p.text.length > 32 ? `${p.text.slice(0, 30)}…` : p.text,
      String(p.seconds),
      `${p.mac.ms} · ${Math.round(p.mac.heard * 100)}%`,
      ...rows.map((r) => {
        const h = r.heard.find((x) => x.id === p.id);
        return h ? `${h.ms} · ${Math.round(h.heard * 100)}%` : "—";
      }),
    ]);
  return lines.map((l) => `| ${l.join(" | ")} |`).join("\n");
}
/** The results so far, written; the table. */
function save() {
  const md = `# Whisper on ${phone}\n\nwhisper.cpp ${version}, q5_1, ms per answer · share of words heard (— failed: over ${ANSWER_MS / 1000} s).\n\n${table(phrases, rows)}\n`;
  writeFileSync(
    join(ROOT, "results.json"),
    JSON.stringify({ phone, version, phrases, rows }, null, 2),
  );
  writeFileSync(join(ROOT, "results.md"), md);
  return md;
}

adb("forward", `tcp:${PHONE_PORT}`, `tcp:${PHONE_PORT}`);
for (const m of MODELS) {
  for (const threads of THREADS) {
    adb("shell", "pkill whisper-server; true");
    const t0 = performance.now();
    const server = spawn(
      "adb",
      [
        ...(process.env.ANDROID_SERIAL ? ["-s", process.env.ANDROID_SERIAL] : []),
        "shell",
        binary,
        "-m",
        models.get(m) as string,
        "-t",
        String(threads),
        "--host",
        "127.0.0.1",
        "--port",
        String(PHONE_PORT),
      ],
      { stdio: "ignore" },
    );
    let up = false;
    for (let i = 0; i < 600 && !up; i++) {
      up = !!(await fetch(`http://127.0.0.1:${PHONE_PORT}/health`).catch(() => undefined))?.ok;
      if (!up) await new Promise((r) => setTimeout(r, 200));
    }
    if (!up) throw new Error(`${m}: the phone's server did not start`);
    const loadMs = Math.round(performance.now() - t0);
    // The first request warms it (as an app's first answer after start).
    await hear(wavs.get("p2") as Uint8Array<ArrayBuffer>, 0);
    for (const window of WINDOWS) {
      const row: Row = { model: m, threads, window, loadMs, heard: [] };
      for (const p of phrases) {
        const r = await hear(
          wavs.get(p.id) as Uint8Array<ArrayBuffer>,
          window === "fitted" ? fitted(p.seconds) : 0,
        );
        // Stuck (a loop of words): the server is busy with it, the setup given up.
        if ("failed" in r) break;
        row.heard.push({ id: p.id, ...r, heard: heard(p.text, r.text) });
      }
      rows.push(row);
      save();
      if (row.heard.length < phrases.length) {
        console.log(`${m} · ${threads} threads · ${window}: stuck on an answer, given up`);
        break;
      }
      const ms = row.heard.map((h) => h.ms);
      const ok = row.heard.map((h) => h.heard);
      console.log(
        `${m} · ${threads} threads · ${window}: ${Math.min(...ms)}–${Math.max(...ms)} ms, words ${Math.round((ok.reduce((a, b) => a + b, 0) / ok.length) * 100)}%`,
      );
    }
    server.kill();
    adb("shell", "pkill whisper-server; true");
  }
}
adb("forward", "--remove", `tcp:${PHONE_PORT}`);

console.log(`\n${save()}\nIn ${ROOT}`);
