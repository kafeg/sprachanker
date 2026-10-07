// Fallback for videos whose direct MP4 is missing (404): remux the HLS stream variant to MP4 with
// ffmpeg (stream copy, no re-encoding). Needs ffmpeg on PATH.
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
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

/** Remuxes the variant into an MP4 at `target` (written by ffmpeg there, moved into place by the caller). */
export async function remuxStream(
  fetcher: PoliteFetcher,
  source: StreamSource,
  target: string,
): Promise<void> {
  const master = await fetcher.text(source.master);
  const variant = variantUrl(master, source.resolution);
  if (!variant) throw new FetchFailedError(source.master, "network");
  await mkdir(dirname(target), { recursive: true });
  const args = ["-loglevel", "error", "-y", "-i", variant, "-c", "copy", "-bsf:a", "aac_adtstoasc"];
  // The target has no .mp4 extension (a temporary name): say the format.
  args.push("-movflags", "+faststart", "-f", "mp4", target);
  const ffmpeg = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  ffmpeg.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    ffmpeg.on("error", reject);
    ffmpeg.on("close", resolve);
  });
  if (code !== 0) throw new Error(`ffmpeg failed for ${variant}: ${stderr.trim()}`);
}
