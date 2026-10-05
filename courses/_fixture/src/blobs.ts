// Synthetic media of the fixture course. A blob's content is a short marker text, so its ref is
// stable; the fixture provider writes these files into a library (stage 2).
import { sha256Hex } from "@sprachanker/course-kit";
import type { BlobRef } from "@sprachanker/schema";

export const FIXTURE_BLOBS = new Map<BlobRef, { content: string; mime: string }>();

export function blob(name: string, mime: string): BlobRef {
  const content = `sprachanker-fixture:${name}`;
  const ref = `blob:sha256:${sha256Hex(content)}`;
  FIXTURE_BLOBS.set(ref, { content, mime });
  return ref;
}

export const video = (name: string) => blob(`${name}.mp4`, "video/mp4");
export const image = (name: string) => blob(`${name}.jpg`, "image/jpeg");
export const audio = (name: string) => blob(`${name}.mp3`, "audio/mpeg");
