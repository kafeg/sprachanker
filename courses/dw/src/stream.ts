// Fallback for videos whose direct MP4 is missing (404): the HLS stream's variant of the same size
// made one MP4 (remux.ts: H.264 and AAC copied, nothing encoded again) — in TypeScript, so the phone
// app does it as the desktop does.
import { type DataFs, FetchFailedError, type PoliteFetcher } from "@sprachanker/course-kit";
import { demuxSegment, type Frame, mp4Header, newDemuxer } from "./remux.ts";

export interface StreamSource {
  /** HLS master playlist. */
  master: string;
  /** Variant to take, e.g. `640x360`. */
  resolution: string;
}

/** URL of the variant playlist with the given resolution in an HLS master playlist. */
export function variantUrl(master: string, resolution: string): string | undefined {
  const lines = master.split("\n").map((line) => line.trim());
  const i = lines.findIndex(
    (line) => line.startsWith("#EXT-X-STREAM-INF") && line.includes(`RESOLUTION=${resolution}`),
  );
  return i >= 0 ? lines[i + 1] : undefined;
}

/** Tags of a playlist whose segments are not one plain run (encrypted, in parts of a file, a break in
 *  their timing, an init section): not read as one. */
const UNSUPPORTED = ["#EXT-X-KEY", "#EXT-X-BYTERANGE", "#EXT-X-DISCONTINUITY", "#EXT-X-MAP"];

/** The segments of a variant playlist, as absolute URLs. */
export function segmentUrls(playlist: string, base: string) {
  const lines = playlist.split("\n").map((line) => line.trim());
  const odd = lines.find((line) => UNSUPPORTED.some((tag) => line.startsWith(tag)));
  if (odd && !odd.startsWith("#EXT-X-KEY:METHOD=NONE"))
    throw new Error(`${base}: the stream cannot be remuxed (${odd.split(":")[0]})`);
  return lines
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => new URL(line, base).href);
}

/** Remuxes the variant into an MP4 at `target` (moved into place by the caller): the frames go to a
 *  file beside it as each segment is read, then the MP4's head and they are written as one. */
export async function remuxStream(
  fetcher: PoliteFetcher,
  fs: DataFs,
  source: StreamSource,
  target: string,
): Promise<void> {
  const master = await fetcher.text(source.master);
  const variant = variantUrl(master, source.resolution);
  if (!variant) throw new FetchFailedError(source.master, "network");
  const variantHref = new URL(variant, source.master).href;
  const segments = segmentUrls(await fetcher.text(variantHref), variantHref);
  if (!segments.length) throw new FetchFailedError(variantHref, "network");
  const [width, height] = source.resolution.split("x").map(Number) as [number, number];
  const demuxer = newDemuxer(width, height);
  const order: Frame["kind"][] = [];
  let dataBytes = 0;
  const frames = `${target}.frames`;
  async function* data() {
    for (const url of segments) {
      for (const frame of demuxSegment(demuxer, (await fetcher.bytes(url)).bytes)) {
        order.push(frame.kind);
        dataBytes += frame.bytes.length;
        yield frame.bytes;
      }
    }
  }
  try {
    await fs.write(frames, data());
    if (!demuxer.video?.samples.length) throw new Error(`${variantHref}: no video in the stream`);
    if (!demuxer.audio?.samples.length) throw new Error(`${variantHref}: no sound in the stream`);
    const head = mp4Header(demuxer, order, dataBytes);
    async function* whole() {
      yield head;
      yield* fs.stream(frames);
    }
    await fs.write(target, whole());
  } finally {
    fs.remove(frames);
  }
}
