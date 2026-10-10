// What was read aloud, kept in <data-root>/cache/tts (08): a WAV per key — Piper's and Qwen3-TTS's
// alike — so a text read again comes at once; the newest are kept, by use.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createOnce } from "../once.ts";
import type { ReadingCache } from "../services/local-engines.ts";
import { removeParts } from "./model-files.ts";

/** What was read aloud and kept: the newest this many (a few hours of replies). */
const KEPT_READINGS = 2000;
/** The cache is pruned after every so many new readings. */
const PRUNE_EVERY = 100;

export function readingCache(dataRoot: string): ReadingCache {
  const cache = join(dataRoot, "cache", "tts");
  removeParts(cache);
  /** Readings being made, by key: a second request for the same one waits for it. */
  const making = createOnce<Uint8Array<ArrayBuffer>>();
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
    async kept(key, produce) {
      const file = join(cache, `${key}.wav`);
      if (existsSync(file)) {
        try {
          const bytes = new Uint8Array(await Bun.file(file).arrayBuffer());
          // Used now: the newest are kept, by use.
          const now = new Date();
          utimesSync(file, now, now);
          return bytes;
        } catch {
          // Pruned meanwhile: made again.
        }
      }
      return making(key, async () => {
        const bytes = await produce();
        mkdirSync(cache, { recursive: true });
        const part = join(cache, `${key}.part`);
        writeFileSync(part, bytes);
        renameSync(part, file);
        if (++made % PRUNE_EVERY === 0) prune();
        return bytes;
      });
    },
  };
}
