// Fetch phase, media: every media URL referenced by the raw pages → media/<kind>/<name> + media.json (03).
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  FetchFailedError,
  type MediaRef,
  type PoliteFetcher,
  urlFileName,
} from "@sprachanker/course-kit";

import { type ApolloState, entitiesOf } from "./apollo.ts";
import { remuxStream, type StreamSource } from "./stream.ts";

/** Image size used for every DW image (`static.dw.com/image/<id>_<format>`): 940×529. */
export const IMAGE_FORMAT = "6";

/** A DW image's URL template (`static.dw.com/image/<id>_${formatId}.<ext>`) in the size downloaded. */
// biome-ignore lint/suspicious/noTemplateCurlyInString: DW's literal URL template placeholder.
export const imageUrl = (template: string) => template.replace("${formatId}", IMAGE_FORMAT);

/** A download's file (a lesson's PDF): DW names it by the link's target and its file name. */
export const downloadUrl = (targetId: unknown, filename: string) =>
  `https://static.dw.com/downloads/${targetId}/${filename.toLowerCase()}`;

/** A video with burned-in subtitles: its name says so ("… mit Untertitel"). */
export const subtitledVideo = (video: Record<string, unknown>) =>
  String(video.name ?? "").includes("Untertitel");

/** A medium a page refers to, before it is named (`mediaName`). */
export type PageMedia = Omit<MediaRef, "name"> & {
  /** Videos: the HLS variant with the same content, used when the direct file is missing. */
  stream?: StreamSource;
};

/** File name of a medium: the source's own name; images and subtitles by their DW id. */
export function mediaName(ref: Pick<MediaRef, "url" | "kind">): string {
  const last = urlFileName(ref.url);
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
  if (subtitledVideo(video)) return {};
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

/** A video's own still (`posterImageUrl`, a DW image in a fixed size); none when it is not one. */
export const posterUrl = (video: Record<string, unknown>): string | undefined => {
  const url = video.posterImageUrl;
  return typeof url === "string" && /^https:\/\/static\.dw\.com\/image\/[\w.-]+$/.test(url)
    ? url
    : undefined;
};

/** Media referenced by one page state. */
export function mediaRefs(state: ApolloState): PageMedia[] {
  const refs: PageMedia[] = [];
  const text = JSON.stringify(state);
  for (const m of text.matchAll(/"mp3Src":"(https:[^"]+)"/g))
    refs.push({ url: m[1] as string, kind: "audio" });
  for (const m of text.matchAll(/https:\/\/static\.dw\.com\/image\/\d+_\$\{formatId\}\.\w+/g))
    refs.push({ url: imageUrl(m[0]), kind: "image" });
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
    const poster = posterUrl(video);
    if (poster) refs.push({ url: poster, kind: "image" });
  }
  for (const link of entitiesOf(state, "ContentLink")) {
    const target = link.target as { __typename?: string; filename?: string } | undefined;
    if (link.targetType === "DOWNLOAD" && target?.filename) {
      refs.push({ url: downloadUrl(link.targetId, target.filename), kind: "pdf" });
    }
  }
  return refs;
}

/** Unique media of every raw page under `rawRoot`. */
export async function collectMedia(rawRoot: string): Promise<PageMedia[]> {
  const byUrl = new Map<string, PageMedia>();
  for (const file of await readdir(rawRoot, { recursive: true })) {
    if (!file.endsWith(".json")) continue;
    const state = JSON.parse(await readFile(join(rawRoot, file), "utf8")) as ApolloState;
    for (const ref of mediaRefs(state)) byUrl.set(ref.url, { ...byUrl.get(ref.url), ...ref });
  }
  return [...byUrl.values()].sort((a, b) => a.url.localeCompare(b.url));
}

/** The file at `ref.url` into `target`, or for a video whose direct file is missing, its remuxed HLS
 *  stream. */
export async function download(fetcher: PoliteFetcher, ref: PageMedia & MediaRef, target: string) {
  try {
    return { mime: (await fetcher.file(ref.url, target)).contentType };
  } catch (error) {
    if (!(error instanceof FetchFailedError && error.status === 404 && ref.stream)) throw error;
    await remuxStream(fetcher, ref.stream, target);
    return { mime: "video/mp4" };
  }
}
