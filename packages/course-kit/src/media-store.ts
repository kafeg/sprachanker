// Media files of a series folder under readable names: media/<kind>/<name> (02).
import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import type { MediaPath } from "@sprachanker/schema";
import { hashFile, tempFile } from "./files.ts";

export interface StoredMedia {
  path: MediaPath;
  sha256: string;
  size: number;
}

export interface MediaStore {
  /** Absolute file of a media path. */
  file(path: MediaPath): string;
  /**
   * Stores a downloaded file (moved, not copied) as `media/<wanted>`, `wanted` being `<kind>/<name>`.
   * The same content under the same name is stored once; different content whose name is taken gets
   * `-2`, `-3`… before the extension.
   */
  putFile(wanted: string, downloaded: string): Promise<StoredMedia>;
  /** The same for bytes in memory. */
  put(wanted: string, bytes: Uint8Array): Promise<StoredMedia>;
}

/** A media name from a source: one plain file name under a kind's folder, nothing that walks out. */
const SAFE = /^(audio|image|video|subtitles|pdf)\/(?!\.\.?$)[^/\\\p{Cc}]+$/u;

export function createMediaStore(seriesDir: string): MediaStore {
  const file = (path: string) => join(seriesDir, path);
  // Two downloads of the same name in one run take turns (eight workers per host).
  const busy = new Map<string, Promise<unknown>>();

  async function place(wanted: string, downloaded: string): Promise<StoredMedia> {
    if (!SAFE.test(wanted)) {
      await rm(downloaded, { force: true });
      throw new Error(`unsafe media name: ${JSON.stringify(wanted)}`);
    }
    const { sha256, size } = await hashFile(downloaded);
    const ext = extname(wanted);
    const stem = wanted.slice(0, wanted.length - ext.length);
    for (let n = 1; ; n++) {
      const path = `media/${n === 1 ? wanted : `${stem}-${n}${ext}`}` as MediaPath;
      const target = file(path);
      if (existsSync(target)) {
        if ((await hashFile(target)).sha256 !== sha256) continue;
        await rm(downloaded, { force: true });
        return { path, sha256, size };
      }
      await mkdir(dirname(target), { recursive: true });
      await rename(downloaded, target);
      return { path, sha256, size };
    }
  }

  const store: MediaStore = {
    file,
    putFile(wanted, downloaded) {
      const turn = (busy.get(wanted) ?? Promise.resolve())
        .catch(() => {})
        .then(() => place(wanted, downloaded));
      busy.set(wanted, turn);
      return turn.finally(() => {
        if (busy.get(wanted) === turn) busy.delete(wanted);
      });
    },
    async put(wanted, bytes) {
      if (!SAFE.test(wanted)) throw new Error(`unsafe media name: ${JSON.stringify(wanted)}`);
      const tmp = tempFile(file(`media/${wanted.replace(/[/\\]/g, "_")}`));
      await mkdir(dirname(tmp), { recursive: true });
      await writeFile(tmp, bytes);
      return store.putFile(wanted, tmp);
    },
  };
  return store;
}
