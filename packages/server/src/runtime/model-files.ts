// Files the speech engines download into <data-root>/models (08): each checked against its sha256 as
// it comes, written to a part file and renamed when whole; parts a stopped server left go when one
// starts (a download starts anew, it does not go on from a part).
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import type { ModelStore } from "../services/local-engines.ts";

/** Downloads a file to `part`, its sha256 checked as it comes; a failed or wrong download leaves
 *  nothing behind. */
export async function downloadChecked(
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

/** Removes what a stopped server left in `dir` — parts of downloads, and what `also` names — before
 *  anything is written there. */
export function removeParts(dir: string, also: (name: string) => boolean = () => false) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir))
    if (name.endsWith(".part") || also(name))
      rmSync(join(dir, name), { recursive: true, force: true });
}

/** The model files in `dir`, its leftover parts removed. */
export function modelStore(dir: string): ModelStore {
  removeParts(dir);
  return {
    path(file, bytes) {
      const path = join(dir, file);
      return statSync(path, { throwIfNoEntry: false })?.size === bytes ? path : undefined;
    },
    async download(url, model, onProgress, signal) {
      mkdirSync(dir, { recursive: true });
      const part = join(dir, `${model.file}.part`);
      await downloadChecked(url, part, model.sha256, onProgress, signal);
      renameSync(part, join(dir, model.file));
    },
    remove(file) {
      rmSync(join(dir, file), { force: true });
      rmSync(join(dir, `${file}.part`), { force: true });
    },
  };
}
