// Fetching a series' media (03): every referenced URL → media/<kind>/<name> through the media store,
// recorded in media.json with sha256 and size. Idempotent: stored files are skipped, failed ones are
// tried again on the next run; one failing file never stops the import.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import type { MediaPath } from "@sprachanker/schema";
import { FetchFailedError, HostRefusedError, type PoliteFetcher } from "./http.ts";
import type { MediaStore } from "./media-store.ts";

export type MediaKind = "audio" | "image" | "video" | "subtitles" | "pdf";

export interface MediaRef {
  url: string;
  kind: MediaKind;
  /** File name to store it under, inside media/<kind>/. */
  name: string;
}

/** Source URL → stored file (path, sha256 and size for integrity checks) or the last error. */
export type MediaIndex = Record<
  string,
  | { kind: MediaKind; path: string; sha256: string; size: number; mime: string }
  | { kind: MediaKind; error: string }
>;

/** Requests in flight per host. */
const WORKERS_PER_HOST = 8;

export async function fetchMedia<R extends MediaRef>(options: {
  fetcher: PoliteFetcher;
  store: MediaStore;
  indexFile: string;
  refs: R[];
  log: (line: string) => void;
  /** How to get one file; by default its URL (providers add fallbacks, e.g. HLS remuxing). */
  download?: (ref: R) => Promise<{ bytes: Uint8Array; mime: string }>;
}): Promise<MediaIndex> {
  const { fetcher, store, indexFile, refs, log } = options;
  const download =
    options.download ??
    (async (ref: R) => {
      const { bytes, contentType } = await fetcher.bytes(ref.url);
      return { bytes, mime: contentType };
    });
  const index: MediaIndex = existsSync(indexFile)
    ? JSON.parse(await readFile(indexFile, "utf8"))
    : {};
  const todo = refs.filter((ref) => !index[ref.url] || "error" in (index[ref.url] as object));
  const byHost = Map.groupBy(todo, (ref) => new URL(ref.url).host);
  let done = 0;
  let saving = Promise.resolve();
  const save = () => {
    saving = saving.then(() => writeFile(indexFile, JSON.stringify(index, null, 1)));
    return saving;
  };
  log(`media: ${todo.length} to fetch of ${refs.length} (${[...byHost.keys()].join(", ")})`);
  const worker = async (host: string, queue: R[]) => {
    for (let ref = queue.shift(); ref; ref = queue.shift()) {
      try {
        const { bytes, mime } = await download(ref);
        const stored = await store.put(`${ref.kind}/${ref.name}`, bytes);
        index[ref.url] = { kind: ref.kind, ...stored, mime };
      } catch (error) {
        if (error instanceof HostRefusedError) {
          log(`media: ${error.message}`);
          queue.length = 0;
          return;
        }
        index[ref.url] = {
          kind: ref.kind,
          error: error instanceof FetchFailedError ? String(error.status) : String(error),
        };
      }
      if (++done % 50 === 0) {
        log(`media: ${done}/${todo.length} (${host})`);
        await save();
      }
    }
  };
  await Promise.all(
    [...byHost].flatMap(([host, hostRefs]) => {
      const queue = [...hostRefs];
      return Array.from({ length: WORKERS_PER_HOST }, () => worker(host, queue));
    }),
  );
  await save();
  return index;
}

/** The stored file of a fetched URL, or undefined when it was not fetched (or failed). */
export function mediaPath(index: MediaIndex, url: string | undefined): MediaPath | undefined {
  const entry = url ? index[url] : undefined;
  return entry && "path" in entry ? (entry.path as MediaPath) : undefined;
}

/** URLs that could not be fetched, with the reason, for the import report. */
export const failedMedia = (index: MediaIndex) =>
  Object.entries(index).flatMap(([url, e]) => ("error" in e ? [`${url}: ${e.error}`] : []));
