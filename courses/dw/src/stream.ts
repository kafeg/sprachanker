// Fallback for videos whose direct MP4 is missing (404): remux the HLS stream variant to MP4 with
// ffmpeg (stream copy, no re-encoding). Needs ffmpeg on PATH.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FetchFailedError, type PoliteFetcher } from "@sprachanker/course-kit";

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

export async function remuxStream(
  fetcher: PoliteFetcher,
  source: StreamSource,
): Promise<Uint8Array> {
  const master = await fetcher.text(source.master);
  const variant = variantUrl(master, source.resolution);
  if (!variant) throw new FetchFailedError(source.master, "network");
  const dir = await mkdtemp(join(tmpdir(), "sprachanker-hls-"));
  const out = join(dir, "video.mp4");
  try {
    const ffmpeg = Bun.spawn(
      [
        "ffmpeg",
        "-loglevel",
        "error",
        "-i",
        variant,
        "-c",
        "copy",
        "-bsf:a",
        "aac_adtstoasc",
        "-movflags",
        "+faststart",
        out,
      ],
      { stdout: "ignore", stderr: "pipe" },
    );
    if ((await ffmpeg.exited) !== 0) {
      throw new Error(`ffmpeg failed for ${variant}: ${await new Response(ffmpeg.stderr).text()}`);
    }
    return new Uint8Array(await readFile(out));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
