// Media files of a series folder under readable names: media/<kind>/<name> (02).
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import type { MediaPath } from "@sprachanker/schema";
import { sha256Hex } from "./fingerprint.ts";

export interface StoredMedia {
  path: MediaPath;
  sha256: string;
  size: number;
}

export interface MediaStore {
  /** Absolute file of a media path. */
  file(path: MediaPath): string;
  /**
   * Stores bytes as `media/<wanted>`. The same content under the same name is stored once; different
   * content whose name is taken gets `-2`, `-3`… before the extension.
   */
  put(wanted: string, bytes: Uint8Array): Promise<StoredMedia>;
}

export function createMediaStore(seriesDir: string): MediaStore {
  const file = (path: string) => join(seriesDir, path);
  return {
    file,
    async put(wanted, bytes) {
      const sha256 = sha256Hex(bytes);
      const ext = extname(wanted);
      const stem = wanted.slice(0, wanted.length - ext.length);
      for (let n = 1; ; n++) {
        const path = `media/${n === 1 ? wanted : `${stem}-${n}${ext}`}` as MediaPath;
        const target = file(path);
        if (existsSync(target)) {
          if (sha256Hex(await readFile(target)) === sha256)
            return { path, sha256, size: bytes.byteLength };
          continue;
        }
        await mkdir(dirname(target), { recursive: true });
        const tmp = `${target}.tmp-${process.pid}`;
        await writeFile(tmp, bytes);
        await rename(tmp, target);
        return { path, sha256, size: bytes.byteLength };
      }
    },
  };
}
