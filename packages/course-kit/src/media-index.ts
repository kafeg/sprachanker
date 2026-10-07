// Fetching a series' media (03): every referenced URL → media/<kind>/<name> through the media store,
// recorded in media.json with sha256 and size. Idempotent: stored files are skipped, failed ones —
// and stored ones gone from the disk — are tried again on the next run; one failing file never stops
// the import, and every file not fetched is in the index with why (a refused host included).
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { MediaPath } from "@sprachanker/schema";
import { tempFile, writeFileAtomic } from "./files.ts";
import { FetchFailedError, HostRefusedError, type PoliteFetcher } from "./http.ts";
import type { MediaStore } from "./media-store.ts";
import type { ProgressSink } from "./provider.ts";

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
  /**
   * How to get one file into `target`; by default its URL (providers add fallbacks, e.g. HLS
   * remuxing). Returns its type.
   */
  download?: (ref: R, target: string) => Promise<{ mime: string }>;
  progress?: ProgressSink;
}): Promise<MediaIndex> {
  const { fetcher, store, indexFile, log, progress } = options;
  const download =
    options.download ??
    (async (ref: R, target: string) => ({
      mime: (await fetcher.file(ref.url, target)).contentType,
    }));
  // Downloads land next to the media (same disk), then move into place.
  const incoming = store.file("media/.incoming" as MediaPath);
  await mkdir(incoming, { recursive: true });
  const index = await readMediaIndex(indexFile);
  // One fetch per URL (a source may name a file twice).
  const refs = [...new Map(options.refs.map((r) => [r.url, r])).values()];
  const stored = (ref: R) => {
    const entry = index[ref.url];
    return !!entry && "path" in entry && existsSync(store.file(entry.path as MediaPath));
  };
  const todo = refs.filter((ref) => !stored(ref));
  const byHost = Map.groupBy(todo, (ref) => new URL(ref.url).host);
  let done = 0;
  let bytes = 0;
  progress?.({ phase: "media", done, total: todo.length, bytes });
  let saving = Promise.resolve();
  const save = () => {
    saving = saving.then(() => writeFileAtomic(indexFile, JSON.stringify(index, null, 1)));
    return saving;
  };
  log(`media: ${todo.length} to fetch of ${refs.length} (${[...byHost.keys()].join(", ")})`);
  const worker = async (host: string, queue: R[]) => {
    for (let ref = queue.shift(); ref; ref = queue.shift()) {
      const target = tempFile(join(incoming, ref.name.replace(/[/\\]/g, "_")));
      try {
        const { mime } = await download(ref, target);
        const put = await store.putFile(`${ref.kind}/${ref.name}`, target);
        index[ref.url] = { kind: ref.kind, ...put, mime };
        bytes += put.size;
      } catch (error) {
        await rm(target, { force: true });
        if (error instanceof HostRefusedError) {
          // This file and the host's others are not fetched this run: recorded, so the report and
          // the check see them missing.
          log(`media: ${error.message}`);
          for (const left of [ref, ...queue.splice(0)])
            index[left.url] = { kind: left.kind, error: `refused ${error.status}` };
          return;
        }
        index[ref.url] = {
          kind: ref.kind,
          error: error instanceof FetchFailedError ? String(error.status) : String(error),
        };
      }
      progress?.({ phase: "media", done: ++done, total: todo.length, bytes });
      // Saved often, so a download stopped midway keeps what it fetched.
      if (done % 10 === 0) await save();
      if (done % 50 === 0) log(`media: ${done}/${todo.length} (${host})`);
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

/** The media index as stored so far (empty before the first fetch). */
export async function readMediaIndex(indexFile: string): Promise<MediaIndex> {
  return existsSync(indexFile) ? JSON.parse(await readFile(indexFile, "utf8")) : {};
}

/** The stored file of a fetched URL, or undefined when it was not fetched (or failed). */
export function mediaPath(index: MediaIndex, url: string | undefined): MediaPath | undefined {
  const entry = url ? index[url] : undefined;
  return entry && "path" in entry ? (entry.path as MediaPath) : undefined;
}

/** URLs that could not be fetched, with the reason, for the import report. */
export const failedMedia = (index: MediaIndex) =>
  Object.entries(index).flatMap(([url, e]) => ("error" in e ? [`${url}: ${e.error}`] : []));

/**
 * File name of a media URL (`MediaRef.name`): the last segment of its path, without the query.
 * `decode` undoes the percent-encoding ("Lesson%201.pdf" → "Lesson 1.pdf").
 */
export function urlFileName(url: string, options: { decode?: boolean } = {}): string {
  const last = new URL(url).pathname.split("/").pop() ?? "";
  return options.decode ? decodeURIComponent(last) : last;
}
