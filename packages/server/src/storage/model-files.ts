// Files the speech engines download into <data-root>/models: each checked against its sha256 as
// it comes, written to a part file and renamed when whole; parts a stopped server left go when one
// starts (a download starts anew, it does not go on from a part).
import { type DataFs, joinPath } from "@sprachanker/course-kit";
import type { ModelStore } from "../services/local-engines.ts";

/** Downloads a file to `part`, its sha256 checked as it comes; a failed or wrong download leaves
 *  nothing behind. */
export async function downloadChecked(
  fs: DataFs,
  fetchFn: typeof fetch,
  url: string,
  part: string,
  sha256: string,
  onProgress: (bytes: number) => void,
  signal: AbortSignal,
) {
  const res = await fetchFn(url, { signal });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const body = res.body;
  async function* counted() {
    let done = 0;
    for await (const chunk of body) {
      done += chunk.length;
      onProgress(done);
      yield chunk;
    }
  }
  try {
    const written = await fs.write(part, counted());
    if (written?.sha256 !== sha256) throw new Error("checksum mismatch");
  } catch (error) {
    fs.remove(part);
    throw error;
  }
}

/** Removes what a stopped server left in `dir` — parts of downloads, and what `also` names — before
 *  anything is written there. */
export function removeParts(
  fs: DataFs,
  dir: string,
  also: (name: string) => boolean = () => false,
) {
  for (const name of fs.list(dir))
    if (name.endsWith(".part") || also(name)) fs.remove(joinPath(dir, name));
}

/** The model files in `dir`, its leftover parts removed; downloads through `fetchFn`. */
export function modelStore(fs: DataFs, dir: string, fetchFn: typeof fetch): ModelStore {
  removeParts(fs, dir);
  return {
    path(file, bytes) {
      const path = joinPath(dir, file);
      return fs.stat(path)?.size === bytes ? path : undefined;
    },
    async download(url, model, onProgress, signal) {
      fs.mkdir(dir);
      const part = joinPath(dir, `${model.file}.part`);
      await downloadChecked(fs, fetchFn, url, part, model.sha256, onProgress, signal);
      fs.rename(part, joinPath(dir, model.file));
    },
    remove(file) {
      fs.remove(joinPath(dir, file));
      fs.remove(joinPath(dir, `${file}.part`));
    },
  };
}
