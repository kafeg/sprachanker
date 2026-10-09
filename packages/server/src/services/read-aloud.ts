// Reading aloud on this machine (08): Piper voices, run by sherpa-onnx's `sherpa-onnx-offline-tts`
// (built in native/piper), each voice downloaded from sherpa-onnx's release and checked against its
// sha256 (piper-voices.json); a text read once with a voice at a speed is kept and served again. One
// engine for the server: each profile picks Piper or its device's voices, and a voice per language.
import { ServiceError } from "../errors.ts";
import { sha256 } from "../security/encoding.ts";
import VOICES from "./piper-voices.json";

export interface PiperVoice {
  id: string;
  lang: string;
  region: string;
  name: string;
  quality: string;
  bytes: number;
  sha256: string;
}

const VOICE_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/";
export const PIPER_VOICES = VOICES as PiperVoice[];

/** What the runtime does for reading aloud: find the engine, keep its voices, run it. */
export interface PiperHost {
  /** The `sherpa-onnx-offline-tts` binary, if it was built (native/). */
  binary(): string | undefined;
  /** The installed voice's folder (its model, tokens and espeak-ng data). */
  voiceDir(id: string): string | undefined;
  /** Downloads a voice's archive (checked), unpacks it, and puts it in place whole. */
  download(
    url: string,
    voice: PiperVoice,
    onProgress: (bytes: number) => void,
    signal: AbortSignal,
  ): Promise<void>;
  remove(id: string): void;
  /** A WAV of `text` said by the voice at `lengthScale` (1: as recorded; larger: slower), kept under
   *  `key` and served from there again. */
  say(
    key: string,
    run: { binary: string; dir: string; id: string; text: string; lengthScale: number },
  ): Promise<Uint8Array<ArrayBuffer>>;
}

/** A text read aloud is at most this long (a reply is read in parts). */
export const SAY_MAX = 2000;

export function createReadAloud(deps: { host?: PiperHost }) {
  const { host } = deps;
  const downloads = new Map<
    string,
    { done: number; controller: AbortController; error?: string }
  >();
  const voiceOf = (id: string) => {
    const voice = PIPER_VOICES.find((v) => v.id === id);
    if (!voice) throw new ServiceError("no_such_model", 404);
    return voice;
  };
  const installed = (v: PiperVoice) => !!host?.voiceDir(v.id);

  /** The voice a profile reads a language with: its choice if installed, else the best installed one
   *  (the language's main region first — de-DE for German — then the highest quality). */
  function voiceFor(lang: string, choice: unknown) {
    const ready = PIPER_VOICES.filter((v) => v.lang === lang && installed(v));
    const main = new Intl.Locale(lang).maximize().region;
    const rank = (v: PiperVoice) =>
      (v.region === main ? 10 : 0) + ["x_low", "low", "medium", "high"].indexOf(v.quality);
    return (
      ready.find((v) => v.id === choice) ??
      [...ready].sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name))[0]
    );
  }

  return {
    /** The engine (built or not) and every voice: installed, downloading, failed. */
    state() {
      return {
        engine: !!host?.binary(),
        voices: PIPER_VOICES.map((v) => {
          const d = downloads.get(v.id);
          return {
            id: v.id,
            lang: v.lang,
            region: v.region,
            name: v.name,
            quality: v.quality,
            bytes: v.bytes,
            installed: installed(v),
            ...(d && !d.error && { downloaded: d.done }),
            ...(d?.error && { error: d.error }),
          };
        }),
      };
    },

    /** Starts downloading a voice (once); its progress is in `state`. */
    download(id: string) {
      const voice = voiceOf(id);
      if (!host) throw new ServiceError("speech_unavailable", 409);
      if (installed(voice) || (downloads.has(id) && !downloads.get(id)?.error)) return;
      const entry: { done: number; controller: AbortController; error?: string } = {
        done: 0,
        controller: new AbortController(),
      };
      downloads.set(id, entry);
      host
        .download(
          `${VOICE_URL}vits-piper-${voice.id}.tar.bz2`,
          voice,
          (n) => (entry.done = n),
          entry.controller.signal,
        )
        .then(() => downloads.delete(id))
        .catch((error: unknown) => {
          entry.error = entry.controller.signal.aborted ? "cancelled" : String(error).slice(0, 200);
        });
    },

    /** Removes a voice (stopping a download of it). */
    remove(id: string) {
      voiceOf(id);
      downloads.get(id)?.controller.abort();
      downloads.delete(id);
      host?.remove(id);
    },

    /** Whether a language can be read with Piper (the engine built and a voice installed). */
    canRead: (lang: string) => !!host?.binary() && !!voiceFor(lang, undefined),

    /** A WAV of a text in a language, with the profile's voice and speed (0.5–1.5). */
    async say(text: string, lang: string, choice: unknown, rate: number) {
      const binary = host?.binary();
      const voice = voiceFor(lang, choice);
      const dir = voice && host?.voiceDir(voice.id);
      if (!host || !binary || !voice || !dir) throw new ServiceError("speech_unavailable", 409);
      const lengthScale = Math.round((1 / rate) * 100) / 100;
      const key = await sha256(`${voice.id}\n${lengthScale}\n${text}`);
      return host
        .say(key, { binary, dir, id: voice.id, text, lengthScale })
        .catch((error: unknown) => {
          console.error("reading aloud:", error);
          throw new ServiceError("speech_engine_failed", 502);
        });
    },
  };
}
export type ReadAloud = ReturnType<typeof createReadAloud>;
