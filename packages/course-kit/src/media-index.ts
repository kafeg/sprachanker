// Fetching a series' media (03): every referenced URL → media/<kind>/<name> through the media store,
// recorded in media.json with sha256 and size. Idempotent: stored files are skipped, failed ones —
// and stored ones gone from the disk — are tried again on the next run; one failing file never stops
// the import, and every file not fetched is in the index with why (a refused host included).
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { issuesText, MediaIndex, type MediaKind, type MediaPath } from "@sprachanker/schema";
import { tempFile, writeFileAtomic } from "./files.ts";
import { FetchFailedError, HostRefusedError, type PoliteFetcher } from "./http.ts";
import { createMediaStore } from "./media-store.ts";
import type { ProgressSink } from "./provider.ts";

export interface MediaRef {
  url: string;
  kind: MediaKind;
  /** File name to store it under, inside media/<kind>/. */
  name: string;
}

/** Requests in flight per host. */
const WORKERS_PER_HOST = 8;

/** A series' media index: `media.json` in its folder (02). */
const indexFileOf = (seriesDir: string) => join(seriesDir, "media.json");

/** A media reference of a URL, stored under its file name unless named otherwise. */
export const mediaRef = (url: string, kind: MediaKind, name = urlFileName(url)): MediaRef => ({
  url,
  kind,
  name,
});

/** Fetches a series' media into its media store and index (`media.json`); returns the index. */
export async function fetchMedia<R extends MediaRef>(options: {
  fetcher: PoliteFetcher;
  seriesDir: string;
  refs: R[];
  log: (line: string) => void;
  /**
   * How to get one file into `target`; by default its URL (providers add fallbacks, e.g. HLS
   * remuxing). Returns its type.
   */
  download?: (ref: R, target: string) => Promise<{ mime: string }>;
  progress?: ProgressSink;
}): Promise<MediaIndex> {
  const { fetcher, log, progress } = options;
  const store = createMediaStore(options.seriesDir);
  const indexFile = indexFileOf(options.seriesDir);
  const download =
    options.download ??
    (async (ref: R, target: string) => ({
      mime: (await fetcher.file(ref.url, target)).contentType,
    }));
  // Downloads land next to the media (same disk), then move into place. What an import cut short left
  // there goes (an import holds its series: nothing else downloads into it now).
  const incoming = store.file("media/.incoming" as MediaPath);
  await rm(incoming, { recursive: true, force: true });
  await mkdir(incoming, { recursive: true });
  const index = await readMediaIndex(options.seriesDir);
  // One file per content: URLs whose files have the same content point to one of them (the first path
  // in order, so a run again gives the same), and content that comes again is not stored twice. Files
  // no URL points to any more stay: what was read before (a pass, a card) may still name them.
  const onDisk = Object.values(index).flatMap((e) =>
    "path" in e && existsSync(store.file(e.path as MediaPath)) ? [e] : [],
  );
  let merged = 0;
  for (const same of Map.groupBy(onDisk, (e) => e.sha256).values()) {
    const path = same.map((e) => e.path).sort()[0] as string;
    for (const e of same)
      if (e.path !== path) {
        e.path = path;
        merged++;
      }
    const first = same[0] as (typeof same)[number];
    store.know({ path: path as MediaPath, sha256: first.sha256, size: first.size });
  }
  if (merged) {
    log(`media: ${merged} URLs point to a file of the same content now`);
    await writeFileAtomic(indexFile, JSON.stringify(index, null, 1));
  }
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

/** A series' media index as stored so far (empty before the first fetch). */
export async function readMediaIndex(seriesDir: string): Promise<MediaIndex> {
  const indexFile = indexFileOf(seriesDir);
  if (!existsSync(indexFile)) return {};
  const read = MediaIndex.safeParse(JSON.parse(await readFile(indexFile, "utf8")));
  if (!read.success) throw new Error(`${indexFile}: ${issuesText(read.error, 2)}`);
  return read.data;
}

/** The stored file of a fetched URL, or undefined when it was not fetched (or failed). */
export function mediaPath(index: MediaIndex, url: string | undefined): MediaPath | undefined {
  const entry = url ? index[url] : undefined;
  return entry && "path" in entry ? (entry.path as MediaPath) : undefined;
}

/** A source's answer that the file is not there (404, 410): gone at the source, not a download to
 *  try again later — the course is complete without it (the normaliser leaves it out). */
const GONE = new Set(["404", "410"]);
const errorOf = (e: MediaIndex[string]) => ("error" in e ? String(e.error) : undefined);

/** URLs that could not be fetched and may be on a later run (network, refusals, server errors), with
 *  the reason, for the import report: a course with any is incomplete. */
export const failedMedia = (index: MediaIndex) =>
  Object.entries(index).flatMap(([url, e]) => {
    const error = errorOf(e);
    return error && !GONE.has(error) ? [`${url}: ${error}`] : [];
  });

/** URLs the source no longer has (404, 410), for the import report; tried again on the next run. */
export const goneMedia = (index: MediaIndex) =>
  Object.entries(index).flatMap(([url, e]) => {
    const error = errorOf(e);
    return error && GONE.has(error) ? [`${url}: ${error}`] : [];
  });

/**
 * File name of a media URL (`MediaRef.name`): the last segment of its path, without the query.
 * `decode` undoes the percent-encoding ("Lesson%201.pdf" → "Lesson 1.pdf").
 */
export function urlFileName(url: string, options: { decode?: boolean } = {}): string {
  const last = new URL(url).pathname.split("/").pop() ?? "";
  return options.decode ? decodeURIComponent(last) : last;
}
