// Fetch phase, media: every media URL referenced by the raw pages → media/<kind>/<name> + media.json (03).
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  FetchFailedError,
  HostRefusedError,
  type MediaStore,
  type PoliteFetcher,
} from "@sprachanker/course-kit";
import { type ApolloState, entitiesOf } from "./apollo.ts";
import { remuxStream, type StreamSource } from "./stream.ts";

/** Image size used for every DW image (`static.dw.com/image/<id>_<format>`): 940×529. */
export const IMAGE_FORMAT = "6";

export type MediaKind = "audio" | "image" | "video" | "subtitles" | "pdf";
export interface MediaRef {
  url: string;
  kind: MediaKind;
  /** Videos: the HLS variant with the same content, used when the direct file is missing. */
  stream?: StreamSource;
}
/** Source URL → stored file (path, sha256 and size for integrity checks) or the last error. */
export type MediaIndex = Record<
  string,
  | { kind: MediaKind; path: string; sha256: string; size: number; mime: string }
  | { kind: MediaKind; error: string }
>;

/** File name of a medium: the source's own name; images and subtitles by their DW id. */
export function mediaName(ref: MediaRef): string {
  const last = new URL(ref.url).pathname.split("/").pop() ?? "";
  const name =
    ref.kind === "image"
      ? last.replace(new RegExp(`_${IMAGE_FORMAT}(\\.\\w+)$`), "$1")
      : ref.kind === "subtitles"
        ? `${last}.vtt`
        : last;
  return name.replace(/[^\w.-]/g, "_");
}

const DOWNLOADS = "https://tvdownloaddw-a.akamaihd.net/downloads/";
const HLS = /^https:\/\/hlsvod\.dw\.com\/i\/(.+?)_,(.+?),\.mp4\.csmil\/master\.m3u8$/;
/** Encodes per size: DW's podcast encodes (sd, hd) or, for re-edited videos, AVC ones. */
const VARIANTS = {
  sd: { file: "PODCAST_SD", avc: "AVC_640x360", stream: "sd", resolution: "640x360" },
  hd: { file: "PODCAST_HD", avc: "AVC_1280x720", stream: "hd", resolution: "1280x720" },
} as const;

/**
 * Direct MP4s of an episode or clip in SD (640×360) and HD (1280×720); none when the video has
 * burned-in subtitles (the separate subtitle track is fetched instead). Download pages list the
 * files (`videoResourceLinks`); lesson pages only give an HLS stream whose variants name the same files.
 */
export function videoFiles(video: Record<string, unknown>): { sd?: string; hd?: string } {
  if (String(video.name ?? "").includes("Untertitel")) return {};
  const files = (video.videoResourceLinks ?? []) as Array<{ url: string; techFormat: string }>;
  const m = HLS.exec(String(video.hlsVideoSrc ?? ""));
  const streams = m ? (m[2] as string).split(",") : [];
  const pick = (size: keyof typeof VARIANTS): string | undefined => {
    const v = VARIANTS[size];
    const file =
      files.find((f) => f.techFormat === v.file) ?? files.find((f) => f.techFormat === v.avc);
    if (file) return DOWNLOADS + file.url;
    if (streams.includes(v.stream)) return `${DOWNLOADS}${m?.[1]}_${v.stream}.mp4`;
    if (streams.includes(v.avc)) return `${DOWNLOADS}${m?.[1]}_${v.avc}.mp4`;
    return undefined;
  };
  const sd = pick("sd");
  const hd = pick("hd");
  return { ...(sd ? { sd } : {}), ...(hd ? { hd } : {}) };
}

/** Media referenced by one page state. */
export function mediaRefs(state: ApolloState): MediaRef[] {
  const refs: MediaRef[] = [];
  const text = JSON.stringify(state);
  for (const m of text.matchAll(/"mp3Src":"(https:[^"]+)"/g))
    refs.push({ url: m[1] as string, kind: "audio" });
  for (const m of text.matchAll(/https:\/\/static\.dw\.com\/image\/(\d+)_\$\{formatId\}\.(\w+)/g)) {
    refs.push({
      url: `https://static.dw.com/image/${m[1]}_${IMAGE_FORMAT}.${m[2]}`,
      kind: "image",
    });
  }
  for (const video of entitiesOf(state, "Video")) {
    const files = videoFiles(video);
    if (!files.sd && !files.hd) continue;
    const master = String(video.hlsVideoSrc ?? "");
    for (const size of ["sd", "hd"] as const) {
      const url = files[size];
      if (!url) continue;
      const stream = HLS.test(master)
        ? { master, resolution: VARIANTS[size].resolution }
        : undefined;
      refs.push({ url, kind: "video", ...(stream ? { stream } : {}) });
    }
    for (const sub of (video.subtitles ?? []) as Array<{ subtitleUrl?: string }>) {
      if (sub.subtitleUrl) refs.push({ url: sub.subtitleUrl, kind: "subtitles" });
    }
  }
  for (const link of entitiesOf(state, "ContentLink")) {
    const target = link.target as { __typename?: string; filename?: string } | undefined;
    if (link.targetType === "DOWNLOAD" && target?.filename) {
      refs.push({
        url: `https://static.dw.com/downloads/${link.targetId}/${target.filename.toLowerCase()}`,
        kind: "pdf",
      });
    }
  }
  return refs;
}

/** Unique media of every raw page under `rawRoot`. */
export async function collectMedia(rawRoot: string): Promise<MediaRef[]> {
  const byUrl = new Map<string, MediaRef>();
  for (const file of await readdir(rawRoot, { recursive: true })) {
    if (!file.endsWith(".json")) continue;
    const state = JSON.parse(await readFile(join(rawRoot, file), "utf8")) as ApolloState;
    for (const ref of mediaRefs(state)) byUrl.set(ref.url, { ...byUrl.get(ref.url), ...ref });
  }
  return [...byUrl.values()].sort((a, b) => a.url.localeCompare(b.url));
}

/** The file at `ref.url`, or for a video whose direct file is missing, its remuxed HLS stream. */
async function download(fetcher: PoliteFetcher, ref: MediaRef) {
  try {
    const { bytes, contentType } = await fetcher.bytes(ref.url);
    return { bytes, mime: contentType };
  } catch (error) {
    if (!(error instanceof FetchFailedError && error.status === 404 && ref.stream)) throw error;
    return { bytes: await remuxStream(fetcher, ref.stream), mime: "video/mp4" };
  }
}

/** Requests in flight per host. */
const WORKERS_PER_HOST = 8;

/** Downloads media missing from the index; failed URLs are retried next run. */
export async function fetchMedia(
  fetcher: PoliteFetcher,
  store: MediaStore,
  indexFile: string,
  refs: MediaRef[],
  log: (line: string) => void,
): Promise<MediaIndex> {
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
  const worker = async (host: string, queue: MediaRef[]) => {
    for (let ref = queue.shift(); ref; ref = queue.shift()) {
      try {
        const { bytes, mime } = await download(fetcher, ref);
        const stored = await store.put(`${ref.kind}/${mediaName(ref)}`, bytes);
        index[ref.url] = { kind: ref.kind, ...stored, mime };
      } catch (error) {
        if (error instanceof HostRefusedError) {
          log(`media: ${error.message}`);
          queue.length = 0;
          return;
        }
        // One file never stops the import: it is reported and tried again on the next run.
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
