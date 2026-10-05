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

/** Image size used for every DW image (`static.dw.com/image/<id>_<format>`): 940×529. */
export const IMAGE_FORMAT = "6";

export type MediaKind = "audio" | "image" | "video" | "subtitles" | "pdf";
export interface MediaRef {
  url: string;
  kind: MediaKind;
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
/** Small variant used for every video: SD of the podcast encodes, else 640×360 of the AVC ones. */
const SMALL = ["PODCAST_SD", "AVC_640x360"];

/**
 * Direct MP4 of an episode or clip in its small variant, or undefined when the video has
 * burned-in subtitles (the separate subtitle track is fetched instead) or no known source.
 * Download pages list the files (`videoResourceLinks`); lesson pages only give an HLS stream
 * whose variants name the same files.
 */
export function videoMp4(video: Record<string, unknown>): string | undefined {
  if (String(video.name ?? "").includes("Untertitel")) return undefined;
  const files = (video.videoResourceLinks ?? []) as Array<{ url: string; techFormat: string }>;
  for (const format of SMALL) {
    const file = files.find((f) => f.techFormat === format);
    if (file) return DOWNLOADS + file.url;
  }
  const m = HLS.exec(String(video.hlsVideoSrc ?? ""));
  if (!m) return undefined;
  const variants = (m[2] as string).split(",");
  if (variants.includes("sd")) return `${DOWNLOADS}${m[1]}_sd.mp4`;
  if (variants.includes("AVC_640x360")) return `${DOWNLOADS}${m[1]}_AVC_640x360.mp4`;
  return undefined;
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
    const mp4 = videoMp4(video);
    if (!mp4) continue;
    refs.push({ url: mp4, kind: "video" });
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
    for (const ref of mediaRefs(state)) byUrl.set(ref.url, ref);
  }
  return [...byUrl.values()].sort((a, b) => a.url.localeCompare(b.url));
}

/** Downloads media missing from the index (one worker per host); failed URLs are retried next run. */
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
  await Promise.all(
    [...byHost].map(async ([host, hostRefs]) => {
      for (const ref of hostRefs) {
        try {
          const res = await fetcher.get(ref.url);
          const bytes = new Uint8Array(await res.arrayBuffer());
          const stored = await store.put(`${ref.kind}/${mediaName(ref)}`, bytes);
          index[ref.url] = {
            kind: ref.kind,
            ...stored,
            mime: res.headers.get("content-type") ?? "",
          };
        } catch (error) {
          if (error instanceof HostRefusedError) {
            log(`media: ${error.message}`);
            break;
          }
          if (!(error instanceof FetchFailedError)) throw error;
          index[ref.url] = { kind: ref.kind, error: String(error.status) };
        }
        if (++done % 50 === 0) {
          log(`media: ${done}/${todo.length} (${host})`);
          await save();
        }
      }
    }),
  );
  await save();
  return index;
}
