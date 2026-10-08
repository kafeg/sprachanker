// The speech engine on this machine (Bun): where `whisper-server` is — beside the app's binary (the
// desktop app bundles it there), else built in the repository (native/scripts/build.ts) or named by
// $SPRACHANKER_WHISPER_SERVER — running it on a local port, and the models in <data-root>/models.
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import type { SpeechHost, WhisperModel } from "../services/speech.ts";

const triple = `${process.arch === "arm64" ? "aarch64" : "x86_64"}-${
  process.platform === "darwin"
    ? "apple-darwin"
    : process.platform === "win32"
      ? "pc-windows-msvc"
      : "unknown-linux-gnu"
}`;

/** Engines running: they go with the server — on its exit and on the signals that stop it — so no
 *  engine is left holding a model in memory. */
const running = new Set<{ kill(): void }>();
let watching = false;
function stopWithServer() {
  if (watching) return;
  watching = true;
  const stopAll = () => {
    for (const proc of running) proc.kill();
    running.clear();
  };
  process.once("exit", stopAll);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
    process.once(signal, () => {
      stopAll();
      process.exit(0);
    });
}

export function speechHost(dataRoot: string): SpeechHost {
  const models = join(dataRoot, "models");
  return {
    whisperBinary() {
      const named = `whisper-server-${triple}`;
      return [
        process.env.SPRACHANKER_WHISPER_SERVER,
        join(dirname(process.execPath), named),
        join(dirname(process.execPath), "whisper-server"),
        join(import.meta.dir, "../../../../native/whisper/out", named),
      ].find((p): p is string => !!p && existsSync(p));
    },
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
    spawnWhisper(binary, model, port) {
      stopWithServer();
      const proc = Bun.spawn(
        [binary, "-m", model, "--host", "127.0.0.1", "--port", String(port), "--no-timestamps"],
        { stdout: "ignore", stderr: "ignore" },
      );
      running.add(proc);
      void proc.exited.then(() => running.delete(proc));
      return { exited: proc.exited, kill: () => proc.kill() };
    },
    models: {
      path(file, bytes) {
        const path = join(models, file);
        return statSync(path, { throwIfNoEntry: false })?.size === bytes ? path : undefined;
      },
      async download(url, model: WhisperModel, onProgress, signal) {
        mkdirSync(models, { recursive: true });
        const part = join(models, `${model.file}.part`);
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
          if (hash.digest("hex") !== model.sha256) throw new Error("checksum mismatch");
          renameSync(part, join(models, model.file));
        } catch (error) {
          out.destroy();
          rmSync(part, { force: true });
          throw error;
        }
      },
      remove(file) {
        rmSync(join(models, file), { force: true });
        rmSync(join(models, `${file}.part`), { force: true });
      },
    },
  };
}
