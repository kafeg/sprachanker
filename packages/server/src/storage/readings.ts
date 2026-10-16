// What was read aloud, kept in <data-root>/cache/tts: a WAV per key — Piper's and Qwen3-TTS's
// alike — so a text read again comes at once; the newest are kept, by use. The same on the computer
// and the phone (over the runtime's DataFs).
import { type DataFs, joinPath } from "@sprachanker/course-kit";
import type { ReadingCache } from "../services/local-engines.ts";
import { untilAborted } from "../services/model-downloads.ts";
import { removeParts } from "./model-files.ts";

/** What was read aloud and kept: the newest this many (a few hours of replies). */
const KEPT_READINGS = 2000;
/** The cache is pruned after every so many new readings. */
const PRUNE_EVERY = 100;

export function readingCache(fs: DataFs, dataRoot: string): ReadingCache {
  const cache = joinPath(dataRoot, "cache", "tts");
  removeParts(fs, cache);
  /** Readings being made, by key: a second request for the same one waits for it; the making stops
   *  once no request waits any more. */
  const making = new Map<
    string,
    { bytes: Promise<Uint8Array<ArrayBuffer>>; stop: AbortController; waiting: number }
  >();
  let made = 0;
  /** Old readings go when there are too many (oldest first). */
  const prune = () => {
    const files = fs
      .list(cache)
      .filter((f) => f.endsWith(".wav"))
      .map((f) => ({ f, at: fs.stat(joinPath(cache, f))?.mtimeMs ?? 0 }))
      .sort((a, b) => b.at - a.at);
    for (const { f } of files.slice(KEPT_READINGS)) fs.remove(joinPath(cache, f));
  };
  return {
    async kept(key, produce, signal = new AbortController().signal) {
      const file = joinPath(cache, `${key}.wav`);
      try {
        const bytes = fs.readBytes(file);
        if (bytes) {
          // Used now: the newest are kept, by use.
          fs.touch(file);
          return new Uint8Array(bytes);
        }
      } catch {
        // Pruned meanwhile: made again.
      }
      let reading = making.get(key);
      if (!reading) {
        const stop = new AbortController();
        const bytes = (async () => {
          const bytes = await produce(stop.signal);
          fs.writeFile(file, bytes);
          if (++made % PRUNE_EVERY === 0) prune();
          return bytes;
        })();
        reading = { bytes, stop, waiting: 0 };
        const mine = reading;
        making.set(key, mine);
        void bytes.catch(() => {}).finally(() => making.get(key) === mine && making.delete(key));
      }
      const r = reading;
      r.waiting++;
      try {
        return await untilAborted(r.bytes, signal);
      } finally {
        // Nobody waits for it any more: stopped, and a request after it makes it anew.
        if (--r.waiting === 0 && signal.aborted) {
          r.stop.abort();
          if (making.get(key) === r) making.delete(key);
        }
      }
    },
  };
}
