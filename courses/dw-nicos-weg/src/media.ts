// Fetch phase, media: every media URL referenced by the raw pages → blobs + media.json index (03).
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type BlobStore,
  FetchFailedError,
  HostRefusedError,
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
export type MediaIndex = Record<
  string,
  | { kind: MediaKind; sha256: string; size: number; mime: string }
  | { kind: MediaKind; error: string }
>;

const HLS_SD_HD = /^https:\/\/hlsvod\.dw\.com\/i\/(.+?)_,sd,hd,\.mp4\.csmil\/master\.m3u8$/;

/** Direct SD MP4 of a plain episode or clip, or undefined for other variants. */
export function sdMp4(hls: string): string | undefined {
  const m = HLS_SD_HD.exec(hls);
  return m ? `https://tvdownloaddw-a.akamaihd.net/downloads/${m[1]}_sd.mp4` : undefined;
}

/** Media referenced by one page state. Burned-in subtitle variants are skipped (separate track). */
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
    const mp4 = sdMp4(String(video.hlsVideoSrc ?? ""));
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
  blobs: BlobStore,
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
          const { sha256, size } = await blobs.put(new Uint8Array(await res.arrayBuffer()));
          index[ref.url] = {
            kind: ref.kind,
            sha256,
            size,
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
