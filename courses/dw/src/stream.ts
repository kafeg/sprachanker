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

/** The segments of a variant playlist, as absolute URLs. */
export const segmentUrls = (playlist: string, base: string) =>
  playlist
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => new URL(line, base).href);

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
