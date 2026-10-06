// Which rendition of a player a lesson takes: the small and the HD video, the MP3 of the audio.
import type { Player } from "../parse.ts";

const videos = (p: Player | undefined) =>
  (p?.renditions ?? []).filter((r) => r.height !== undefined) as { url: string; height: number }[];

/** The small rendition: 360p, else the smallest of at least 270p, else the largest there is. */
export function sdUrl(player: Player | undefined): string | undefined {
  const all = videos(player).sort((a, b) => a.height - b.height);
  return (all.find((r) => r.height === 360) ?? all.find((r) => r.height >= 270) ?? all.at(-1))?.url;
}

/** The 720p rendition, if offered. */
export const hdUrl = (player: Player | undefined) =>
  videos(player).find((r) => r.height === 720)?.url;

/** 64 kbps MP3, else the lowest bit rate offered. */
export function audioUrl(player: Player | undefined): string | undefined {
  const all = (player?.renditions ?? [])
    .filter((r) => r.kbps !== undefined)
    .sort((a, b) => (a.kbps ?? 0) - (b.kbps ?? 0));
  return (all.find((r) => r.kbps === 64) ?? all[0])?.url;
}
