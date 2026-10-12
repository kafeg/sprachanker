// Silence in a take (08): how much of a 16-bit PCM WAV is loud enough to be speech, and what of what
// Whisper heard is not speech — sounds it names ("* Musik *"), credits it adds at any loudness
// ("Untertitelung des ZDF, 2020") and phrases it makes up of silence and noise ("Vielen Dank.") —
// by language, as data (hallucinations.json). Measured with whisper-server's large-v3-turbo on human
// course recordings, Piper and Qwen3-TTS at levels down to -45 dBFS, and on noise and breathing.
import PHRASES from "./hallucinations.json" with { type: "json" };

const FRAME_MS = 20;
/** A 20 ms stretch this loud (root mean square, -50 dBFS) may hold speech; a quiet room is not. */
const SPEECH_RMS = 0.00316;
/** Less than this much speech-loud is nothing to hear: the recogniser is not asked. A short word
 *  said quietly ("Ich" at -45 dBFS) still has 60 ms. */
const SILENT_MS = 40;
/** A stretch this loud (-40 dBFS) is speech at a normal distance from the microphone. */
const LOUD_RMS = 0.01;
/** Near-silent: never louder than QUIET_RMS (-36.5 dBFS) and under NEAR_SILENT_MS loud. A word said
 *  normally peaks at -15…-30 dBFS. */
const QUIET_RMS = 0.015;
const NEAR_SILENT_MS = 250;
/** Little loud time: under SHORT_LOUD_MS as loud as speech at a normal distance — a tap (160 ms), a
 *  word said quietly; a short word said normally has 240 ms and more. */
const SHORT_LOUD_MS = 200;
/** Whisper unsure of what it heard (a segment's mean log probability below this). Said aloud by
 *  course speakers and both voices, words measured above -0.36; made up of a tap, -0.58 (of steady
 *  noise, as sure as words: `steady` says it). A learner's accent lowers it, so being unsure alone
 *  drops nothing. */
const UNSURE_LOGPROB = -0.55;
/** Steady — noise or hum, not speech: the 20 ms levels (dB, from -60 dBFS up) vary less than
 *  STEADY_SPREAD_DB (standard deviation) and the loudest is under STEADY_RISE_DB above the middle one.
 *  Measured: white and pink noise and hum 0–3 dB and 0–9.2 dB; words and the pauses between them 5.4 dB
 *  and more (over pink noise at -23 dBFS too), or — one phrase in a long take, its room's noise
 *  around it — 15 dB and more above the middle; but quiet speech (-36…-40 dBFS) over noise 10 dB below
 *  it is steady too, so a steady take only makes what Whisper heard doubtful. */
const STEADY_SPREAD_DB = 4;
const STEADY_RISE_DB = 10;

export interface Loudness {
  /** How long the take was loud enough to hold speech (-50 dBFS). */
  speechMs: number;
  /** How long it was as loud as speech at a normal distance (-40 dBFS). */
  loudMs: number;
  /** The loudest 20 ms (root mean square, 0–1). */
  peak: number;
  /** Its level hardly changes: noise, not speech. */
  steady: boolean;
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
      let speech = 0;
      let loud = 0;
      let peak = 0;
      const levels: number[] = [];
      for (let start = body; start + step <= end; start += frame * step) {
        let sum = 0;
        let n = 0;
        for (let i = start; i + 2 <= end && n < frame; i += step, n++)
          sum += (view.getInt16(i, true) / 32768) ** 2;
        const rms = Math.sqrt(sum / n);
        peak = Math.max(peak, rms);
        if (rms >= SPEECH_RMS) speech++;
        if (rms >= LOUD_RMS) loud++;
        levels.push(Math.max(-60, 20 * Math.log10(rms || 1e-6)));
      }
      const mean = levels.reduce((a, b) => a + b, 0) / (levels.length || 1);
      const spread = Math.sqrt(
        levels.reduce((a, b) => a + (b - mean) ** 2, 0) / (levels.length || 1),
      );
      const sorted = [...levels].sort((a, b) => a - b);
      const rise = (sorted.at(-1) ?? -60) - (sorted[sorted.length >> 1] ?? -60);
      return {
        speechMs: speech * FRAME_MS,
        loudMs: loud * FRAME_MS,
        peak,
        steady: spread < STEADY_SPREAD_DB && rise < STEADY_RISE_DB,
      };
    }
    at = body + size + (size % 2);
  }
  return undefined;
}

/** Nothing in the take loud enough to be speech. */
export const silent = (l: Loudness) => l.speechMs < SILENT_MS;

const nearSilent = (l: Loudness) => l.peak < QUIET_RMS && l.loudMs < NEAR_SILENT_MS;

const normal = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Each language's credits (ending in "…": a sentence they start, and all after it) and phrases. */
const MADE_UP = new Map(
  Object.entries(PHRASES as Record<string, string[]>).map(([lang, list]) => [
    lang,
    {
      credits: list.filter((p) => p.endsWith("…")).map(normal),
      phrases: list.filter((p) => !p.endsWith("…")).map(normal),
    },
  ]),
);

/** A sound Whisper names: "* Musik *", "[Applaus]", "(lacht)", "♪ … ♪". */
const SOUND = String.raw`(?:\*[^*]*\*|\[[^\]]*\]|\([^)]*\)|♪[^♪]*♪)`;
const SOUNDS = new RegExp(SOUND, "gu");
const LEADING = new RegExp(String.raw`^\s*(?:${SOUND}\s+)+`, "u");
const TRAILING = new RegExp(String.raw`(?<=[.!?…])(?:\s+${SOUND})+\s*$`, "u");

/** What Whisper heard without the sounds it names: nothing when they are all of it (or punctuation
 *  alone is left: "..."); those standing apart before or after what was said gone; parentheses inside
 *  a sentence kept ("Ich komme (vielleicht) morgen."). */
export function withoutSounds(text: string): string {
  if (!/[\p{L}\p{N}]/u.test(text.replace(SOUNDS, " "))) return "";
  return text.replace(LEADING, "").replace(TRAILING, "").replace(/\s+/g, " ").trim();
}

/** What was said without a credit Whisper adds: from the sentence one starts to the end ("Ich heiße
 *  Anna. Untertitel im Auftrag des ZDF, 2020" → "Ich heiße Anna."). */
function withoutCredits(text: string, credits: readonly string[]) {
  const sentences = text.split(/(?<=[.!?…])\s+/u);
  const at = sentences.findIndex((s) => credits.some((c) => normal(s).startsWith(c)));
  return at < 0 ? text : sentences.slice(0, at).join(" ");
}

/**
 * What the learner said, of what the recogniser heard in a take (`logprob`: the least sure of its
 * segments): nothing for sounds and credits (a credit after what was said cut off); nothing for a
 * phrase Whisper makes up of silence and noise when the take was steady (noise), or when it is unsure
 * of it and the take was near-silent or loud only briefly; nothing for anything it is unsure of in a
 * steady take loud only briefly
 * — unless it is one of the lines to say (`expected`, never given to the recogniser). A real short
 * answer ("Danke.") is kept: Whisper is sure of it, or it was loud long enough.
 */
export function said(
  heard: { text: string; logprob?: number },
  sound: Loudness | undefined,
  lang: string,
  expected: readonly string[] = [],
): string {
  const whole = withoutSounds(heard.text);
  const all = normal(whole);
  if (!all || expected.some((line) => normal(line) === all)) return whole;
  const { credits = [], phrases = [] } = MADE_UP.get(lang.split("-")[0] ?? lang) ?? {};
  const text = withoutCredits(whole, credits);
  const words = normal(text);
  if (!words) return "";
  const unsure = heard.logprob !== undefined && heard.logprob < UNSURE_LOGPROB;
  const brief = sound !== undefined && sound.loudMs < SHORT_LOUD_MS;
  if (sound?.steady && unsure && brief) return "";
  // Of steady noise Whisper makes phrases up as sure of them as of words said ("Amen." of -42 dBFS
  // noise at -0.17…-0.36, "Vielen Dank." of -38 dBFS): there a phrase is doubtful at any logprob.
  const doubtful =
    sound !== undefined && (sound.steady || (unsure && (nearSilent(sound) || brief)));
  return doubtful && phrases.includes(words) ? "" : text;
}
