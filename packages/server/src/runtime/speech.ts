// The speech engines on this machine (Bun): where `whisper-server` and `sherpa-onnx-offline-tts` are —
// beside the app's binary (the desktop app bundles them there), else built in the repository
// (native/scripts/build.ts) or named by $SPRACHANKER_WHISPER_SERVER / $SPRACHANKER_PIPER — running
// them, and their models and voices in <data-root>/models; what was read aloud in <data-root>/cache/tts.
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import type { PiperHost } from "../services/read-aloud.ts";
import type { ModelFile, SpeechHost } from "../services/speech.ts";

/** This machine's target triple: the speech engine built for it is `whisper-server-<triple>`. */
export const triple = `${process.arch === "arm64" ? "aarch64" : "x86_64"}-${
  process.platform === "darwin"
    ? "apple-darwin"
    : process.platform === "win32"
      ? "pc-windows-msvc"
      : "unknown-linux-gnu"
}`;

/** Engines running: they go with the server — on its exit and on the signals that stop it — so no
 *  engine is left holding a model in memory. Their pids are kept in a file, so one left by a server
 *  that was killed outright is stopped when the next one starts. */
const running = new Map<number, { kill(): void }>();
let pidFile: string | undefined;
const writePids = () => {
  if (!pidFile) return;
  if (running.size) writeFileSync(pidFile, [...running.keys()].join("\n"));
  else rmSync(pidFile, { force: true });
};

function stopWithServer() {
  const stopAll = () => {
    for (const proc of running.values()) proc.kill();
    running.clear();
    writePids();
  };
  process.once("exit", stopAll);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
    process.once(signal, () => {
      stopAll();
      process.exit(0);
    });
}

/** Stops engines a killed server left running (only processes that are its engines; the server
 *  starting holds the data folder, so none of them is another server's). */
function stopLeftOver(file: string) {
  const pids = (existsSync(file) ? readFileSync(file, "utf8") : "")
    .split("\n")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  for (const pid of pids) {
    try {
      // `ps` names the process (POSIX); elsewhere the pid alone is not trusted enough to stop it.
      if (process.platform === "win32") continue;
      const name = Bun.spawnSync(["ps", "-p", String(pid), "-o", "comm="]).stdout.toString();
      if (name.includes("whisper-server") || name.includes("tts-server")) process.kill(pid);
    } catch {
      // Gone meanwhile, or not ours to stop.
    }
  }
  rmSync(file, { force: true });
}

/** Downloads a file to `part`, its sha256 checked as it comes; a failed or wrong download leaves
 *  nothing behind. */
async function downloadChecked(
  url: string,
  part: string,
  sha256: string,
  onProgress: (bytes: number) => void,
  signal: AbortSignal,
) {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const hash = new Bun.CryptoHasher("sha256");
  const out = createWriteStream(part);
  let done = 0;
  try {
    for await (const chunk of res.body) {
      hash.update(chunk);
      done += chunk.length;
      onProgress(done);
      if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
    }
    await new Promise<void>((resolve, reject) =>
      out.end((e?: Error | null) => (e ? reject(e) : resolve())),
    );
    if (hash.digest("hex") !== sha256) throw new Error("checksum mismatch");
  } catch (error) {
    out.destroy();
    rmSync(part, { force: true });
    throw error;
  }
}

/** Where a program built in native/ is: named by an environment variable, beside the app's binary
 *  (with or without the target triple), else in the repository's build. */
const engineAt = (env: string | undefined, folder: string, program: string) =>
  [
    env,
    join(dirname(process.execPath), `${program}-${triple}`),
    join(dirname(process.execPath), program),
    join(import.meta.dir, "../../../../native", folder, "out", `${program}-${triple}`),
  ].find((p): p is string => !!p && existsSync(p));

export function speechHost(dataRoot: string): SpeechHost {
  const models = join(dataRoot, "models");
  pidFile = join(models, "engines.pid");
  stopLeftOver(pidFile);
  stopLeftOver(join(models, "whisper-server.pid"));
  stopWithServer();
  /** Runs an engine on a local port, kept in the pid file while it runs. */
  const spawnEngine = (args: string[]) => {
    const proc = Bun.spawn(args, { stdout: "ignore", stderr: "ignore" });
    mkdirSync(models, { recursive: true });
    running.set(proc.pid, proc);
    writePids();
    void proc.exited.then(() => {
      running.delete(proc.pid);
      writePids();
    });
    return { exited: proc.exited, kill: () => proc.kill() };
  };
  return {
    whisperBinary: () =>
      engineAt(process.env.SPRACHANKER_WHISPER_SERVER, "whisper", "whisper-server"),
    freePort: () =>
      new Promise((resolve, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          const port = typeof address === "object" && address ? address.port : 0;
          server.close(() => resolve(port));
        });
      }),
    spawnWhisper: (binary, model, port) =>
      spawnEngine([
        binary,
        "-m",
        model,
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--no-timestamps",
      ]),
    qwenBinary: () => engineAt(process.env.SPRACHANKER_QWEN, "qwen", "tts-server"),
    spawnQwen: (binary, talker, codec, port) =>
      spawnEngine([
        binary,
        "--model",
        talker,
        "--codec",
        codec,
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
      ]),
    models: {
      path(file, bytes) {
        const path = join(models, file);
        return statSync(path, { throwIfNoEntry: false })?.size === bytes ? path : undefined;
      },
      async download(url, model: ModelFile, onProgress, signal) {
        mkdirSync(models, { recursive: true });
        const part = join(models, `${model.file}.part`);
        await downloadChecked(url, part, model.sha256, onProgress, signal);
        renameSync(part, join(models, model.file));
      },
      remove(file) {
        rmSync(join(models, file), { force: true });
        rmSync(join(models, `${file}.part`), { force: true });
      },
    },
  };
}

/** What was read aloud and kept: the newest this many (a few hours of replies). */
const KEPT_READINGS = 2000;
/** A text of a reply is read in a second or two; one that takes longer is stuck. */
const SAY_MS = 60_000;

export function piperHost(dataRoot: string): PiperHost {
  const voices = join(dataRoot, "models", "voices");
  const cache = join(dataRoot, "cache", "tts");
  /** Readings being made, by key: a second request for the same one waits for it. */
  const making = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();
  /** New readings since the cache was last pruned (pruned every so many). */
  let made = 0;
  /** Old readings go when there are too many (oldest first). */
  const prune = () => {
    const files = readdirSync(cache)
      .filter((f) => f.endsWith(".wav"))
      .map((f) => ({ f, at: statSync(join(cache, f)).mtimeMs }))
      .sort((a, b) => b.at - a.at);
    for (const { f } of files.slice(KEPT_READINGS)) rmSync(join(cache, f), { force: true });
  };
  return {
    binary: () => engineAt(process.env.SPRACHANKER_PIPER, "piper", "sherpa-onnx-offline-tts"),
    voiceDir(id) {
      const dir = join(voices, id);
      return existsSync(join(dir, `${id}.onnx`)) ? dir : undefined;
    },
    async download(url, voice, onProgress, signal) {
      mkdirSync(voices, { recursive: true });
      const archive = join(voices, `${voice.id}.tar.bz2.part`);
      const unpacked = join(voices, `${voice.id}.part`);
      await downloadChecked(url, archive, voice.sha256, onProgress, signal);
      try {
        rmSync(unpacked, { recursive: true, force: true });
        mkdirSync(unpacked, { recursive: true });
        // The archive holds one folder, vits-piper-<id>: the model, its tokens and espeak-ng data.
        // Unpacked by another process, so the server goes on answering meanwhile.
        const tar = Bun.spawn(["tar", "-xjf", archive, "-C", unpacked], { stderr: "pipe" });
        if ((await tar.exited) !== 0)
          throw new Error(
            `unpacking failed: ${(await new Response(tar.stderr).text()).slice(0, 200)}`,
          );
        rmSync(join(voices, voice.id), { recursive: true, force: true });
        renameSync(join(unpacked, `vits-piper-${voice.id}`), join(voices, voice.id));
      } finally {
        rmSync(archive, { force: true });
        rmSync(unpacked, { recursive: true, force: true });
      }
    },
    remove(id) {
      rmSync(join(voices, id), { recursive: true, force: true });
      rmSync(join(voices, `${id}.part`), { recursive: true, force: true });
      rmSync(join(voices, `${id}.tar.bz2.part`), { force: true });
    },
    say: (key, run) => kept(key, () => runPiper(key, run)),
    kept,
  };

  /** A reading kept under `key`: read from the cache, else made once (a second request for it waits
   *  for the first) and written there whole. */
  async function kept(key: string, produce: () => Promise<Uint8Array<ArrayBuffer>>) {
    const file = join(cache, `${key}.wav`);
    if (existsSync(file)) return new Uint8Array(await Bun.file(file).arrayBuffer());
    let pending = making.get(key);
    if (!pending) {
      pending = (async () => {
        const bytes = await produce();
        mkdirSync(cache, { recursive: true });
        const part = join(cache, `${key}.part`);
        writeFileSync(part, bytes);
        renameSync(part, file);
        if (++made % 100 === 0) prune();
        return bytes;
      })().finally(() => making.delete(key));
      making.set(key, pending);
    }
    return pending;
  }

  /** Runs Piper once for a reading: its WAV's bytes. */
  async function runPiper(
    key: string,
    { binary, dir, id, text, lengthScale }: Parameters<PiperHost["say"]>[1],
  ) {
    mkdirSync(cache, { recursive: true });
    const out = join(cache, `${key}.piper.wav`);
    const proc = Bun.spawn(
      [
        binary,
        `--vits-model=${join(dir, `${id}.onnx`)}`,
        `--vits-tokens=${join(dir, "tokens.txt")}`,
        `--vits-data-dir=${join(dir, "espeak-ng-data")}`,
        `--vits-length-scale=${lengthScale}`,
        "--num-threads=2",
        `--output-filename=${out}`,
        text,
      ],
      { stdout: "ignore", stderr: "ignore" },
    );
    const timer = setTimeout(() => proc.kill(), SAY_MS);
    try {
      const code = await proc.exited.finally(() => clearTimeout(timer));
      if (code !== 0 || !existsSync(out)) throw new Error(`reading aloud failed (${code})`);
      return new Uint8Array(await Bun.file(out).arrayBuffer());
    } finally {
      rmSync(out, { force: true });
    }
  }
}
