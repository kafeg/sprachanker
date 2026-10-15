// Files the speech engines download into <data-root>/models: each checked against its sha256 as
// it comes, written to a part file and renamed when whole; parts a stopped server left go when one
// starts (a download starts anew, it does not go on from a part).
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
import { join } from "node:path";
import type { ModelStore, VoiceStore } from "../services/local-engines.ts";

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

/** The voices taken for words in `dir`, by language: `<lang>-<id>.wav` and `<lang>.json` (what is
 *  known of it, its id among it), each written whole (a part renamed), the JSON last; a JSON whose
 *  recording is not there is no voice. A voice put lets the language's earlier recordings go. */
export function voiceStore(dir: string): VoiceStore {
  removeParts(dir);
  const check = (lang: string, id = "0") => {
    if (!/^[a-z]{2,3}$/.test(lang) || !/^[0-9a-f]+$/.test(id))
      throw new Error(`not a voice: ${lang} ${id}`);
  };
  const write = (path: string, data: string | Uint8Array) => {
    writeFileSync(`${path}.part`, data);
    renameSync(`${path}.part`, path);
  };
  return {
    get(lang) {
      try {
        check(lang);
        const about: unknown = JSON.parse(readFileSync(join(dir, `${lang}.json`), "utf8"));
        const id = String((about as { id?: unknown }).id);
        check(lang, id);
        return { wav: new Uint8Array(readFileSync(join(dir, `${lang}-${id}.wav`))), about };
      } catch {
        return undefined;
      }
    },
    put(lang, { id, wav, about }) {
      check(lang, id);
      mkdirSync(dir, { recursive: true });
      const kept = `${lang}-${id}.wav`;
      write(join(dir, kept), wav);
      write(join(dir, `${lang}.json`), `${JSON.stringify(about, null, 2)}\n`);
      for (const name of readdirSync(dir))
        if (name.startsWith(`${lang}-`) && name.endsWith(".wav") && name !== kept)
          rmSync(join(dir, name), { force: true });
    },
  };
}
