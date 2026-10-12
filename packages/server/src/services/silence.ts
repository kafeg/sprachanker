// Silence in a take (08): how much of a 16-bit PCM WAV is loud enough to be speech, and what Whisper is
// known to make up for a near-silent one — by language, as data (hallucinations.json).
import PHRASES from "./hallucinations.json" with { type: "json" };

/** A 20 ms stretch this loud (root mean square, about -40 dBFS) may hold speech; a quiet room is
 *  not. */
const SPEECH_RMS = 0.01;
const FRAME_MS = 20;
/** Less than this much loud is nothing to hear: the recogniser is not asked. */
const SILENT_MS = 120;
/** Less than this much loud, or never louder than QUIET_RMS, is near-silent: what the recogniser makes
 *  of it is checked against the phrases it makes up. */
const NEAR_SILENT_MS = 250;
const QUIET_RMS = 0.03;

export interface Loudness {
  /** How long the take was loud enough to be speech. */
  loudMs: number;
  /** The loudest 20 ms (root mean square, 0–1). */
  peak: number;
}

/** A 16-bit PCM WAV's loudness; undefined for anything else (a course's MP3). */
export function loudness(wav: Uint8Array): Loudness | undefined {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const tag = (at: number) =>
    at + 4 <= wav.length ? String.fromCharCode(...wav.subarray(at, at + 4)) : "";
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return undefined;
  let format: { channels: number; rate: number; bits: number; pcm: boolean } | undefined;
  for (let at = 12; at + 8 <= wav.length; ) {
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (tag(at) === "fmt " && size >= 16)
      format = {
        pcm: view.getUint16(body, true) === 1,
        channels: view.getUint16(body + 2, true),
        rate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    if (tag(at) === "data") {
      if (!format?.pcm || format.bits !== 16 || !format.channels || !format.rate) return undefined;
      const end = Math.min(wav.length, body + size);
      const step = 2 * format.channels;
      const frame = Math.max(1, Math.round((format.rate * FRAME_MS) / 1000));
      let loud = 0;
      let peak = 0;
      for (let start = body; start + step <= end; start += frame * step) {
        let sum = 0;
        let n = 0;
        for (let i = start; i + 2 <= end && n < frame; i += step, n++)
          sum += (view.getInt16(i, true) / 32768) ** 2;
        const rms = Math.sqrt(sum / n);
        peak = Math.max(peak, rms);
        if (rms >= SPEECH_RMS) loud++;
      }
      return { loudMs: loud * FRAME_MS, peak };
    }
    at = body + size + (size % 2);
  }
  return undefined;
}

/** Nothing in the take loud enough to be speech. */
export const silent = (l: Loudness) => l.loudMs < SILENT_MS;

const normal = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const MADE_UP = new Map(
  Object.entries(PHRASES as Record<string, string[]>).map(([lang, phrases]) => [
    lang,
    phrases.map((p) => ({ prefix: p.endsWith("…"), text: normal(p) })),
  ]),
);

/** What the recogniser heard in a near-silent take is one of the phrases it makes up of silence in
 *  that language (a phrase ending in "…" stands for any it starts). */
export function madeUp(l: Loudness, text: string, lang: string): boolean {
  if (l.loudMs >= NEAR_SILENT_MS && l.peak >= QUIET_RMS) return false;
  const heard = normal(text);
  return (MADE_UP.get(lang.split("-")[0] ?? lang) ?? []).some((p) =>
    p.prefix ? heard.startsWith(p.text) : heard === p.text,
  );
}
