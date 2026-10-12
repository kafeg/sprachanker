// Media files of a series folder under readable names: media/<kind>/<name>.
import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { type MediaPath, storableMedia } from "@sprachanker/schema";
import { hashFile, tempFile } from "./files.ts";

interface StoredMedia {
  path: MediaPath;
  sha256: string;
  size: number;
}

interface MediaStore {
  /** Absolute file of a media path. */
  file(path: MediaPath): string;
  /**
   * Stores a downloaded file (moved, not copied) as `media/<wanted>`, `wanted` being `<kind>/<name>`
   * (its extension lower-cased; refused unless `storableMedia`: a portable name, an extension of its
   * kind — never HTML, SVG, a script).
   * The same content is stored once, under whatever name it came first (one known to the store, or
   * stored by it); different content whose name is taken gets `-2`, `-3`… before the extension.
   */
  putFile(wanted: string, downloaded: string): Promise<StoredMedia>;
  /** A file already in the series (from media.json): content that comes again is not stored twice. */
  know(stored: StoredMedia): void;
  /** The same for bytes in memory. */
  put(wanted: string, bytes: Uint8Array): Promise<StoredMedia>;
}

/** A media name from a source as stored: its extension in lower case. */
const lowerExtension = (wanted: string) => {
  const ext = extname(wanted);
  return `${wanted.slice(0, wanted.length - ext.length)}${ext.toLowerCase()}`;
};

export function createMediaStore(seriesDir: string): MediaStore {
  const file = (path: string) => join(seriesDir, path);
  // Two downloads of the same name in one run take turns (eight workers per host).
  const busy = new Map<string, Promise<unknown>>();
  /** The stored file of each content, by sha256: one placed or being placed. */
  const byHash = new Map<string, Promise<StoredMedia>>();

  async function place(wanted: string, downloaded: string): Promise<StoredMedia> {
    if (!storableMedia(wanted)) {
      await rm(downloaded, { force: true });
      throw new Error(`unsafe media name: ${JSON.stringify(wanted)}`);
    }
    const { sha256, size } = await hashFile(downloaded);
    // Content stored already (or being stored by another download now): that file, not a second one.
    const same = byHash.get(sha256);
    if (same) {
      const stored = await same.catch(() => undefined);
      if (stored && existsSync(file(stored.path))) {
        await rm(downloaded, { force: true });
        return stored;
      }
    }
    const placed = placeNew(wanted, downloaded, sha256, size);
    byHash.set(sha256, placed);
    return placed;
  }

  async function placeNew(
    wanted: string,
    downloaded: string,
    sha256: string,
    size: number,
  ): Promise<StoredMedia> {
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
    know(stored) {
      if (!byHash.has(stored.sha256)) byHash.set(stored.sha256, Promise.resolve(stored));
    },
    putFile(name, downloaded) {
      const wanted = lowerExtension(name);
      const turn = (busy.get(wanted) ?? Promise.resolve())
        .catch(() => {})
        .then(() => place(wanted, downloaded));
      busy.set(wanted, turn);
      return turn.finally(() => {
        if (busy.get(wanted) === turn) busy.delete(wanted);
      });
    },
    async put(name, bytes) {
      const wanted = lowerExtension(name);
      if (!storableMedia(wanted)) throw new Error(`unsafe media name: ${JSON.stringify(wanted)}`);
      const tmp = tempFile(file(`media/${wanted.replace(/[/\\]/g, "_")}`));
      await mkdir(dirname(tmp), { recursive: true });
      await writeFile(tmp, bytes);
      return store.putFile(wanted, tmp);
    },
  };
  return store;
}
