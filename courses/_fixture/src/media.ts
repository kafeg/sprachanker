// Synthetic media of the fixture course: short marker texts under readable names; the fixture
// provider writes them into a library (stage 2).
import type { MediaPath } from "@sprachanker/schema";

export const FIXTURE_MEDIA = new Map<MediaPath, { content: string; mime: string }>();

function medium(kind: string, name: string, mime: string): MediaPath {
  const path = `media/${kind}/${name}` as MediaPath;
  FIXTURE_MEDIA.set(path, { content: `sprachanker-fixture:${name}`, mime });
  return path;
}

export const video = (name: string) => medium("video", `${name}.mp4`, "video/mp4");
export const image = (name: string) => medium("image", `${name}.jpg`, "image/jpeg");
export const audio = (name: string) => medium("audio", `${name}.mp3`, "audio/mpeg");
export const pdf = (name: string) => medium("pdf", `${name}.pdf`, "application/pdf");
