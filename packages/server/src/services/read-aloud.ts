// Reading aloud on this machine (08): Piper voices, run by sherpa-onnx's `sherpa-onnx-offline-tts`
// (built in native/piper), each voice downloaded from sherpa-onnx's release and checked against its
// sha256 (piper-voices.json); a text read once with a voice at a speed is kept and served again. One
// engine for the server: each profile picks Piper or its device's voices, and a voice per language.
import { ServiceError } from "../errors.ts";
import { sha256 } from "../security/encoding.ts";
import { keptIn, offered, type ReadingCache } from "./local-engines.ts";
import { createModelDownloads } from "./model-downloads.ts";
import VOICES from "./piper-voices.json" with { type: "json" };

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
const QUALITY = ["x_low", "low", "medium", "high"];

/** The voices offered, each language's best first: its main region (de-DE for German), then the
 *  highest quality. */
const PIPER_VOICES: PiperVoice[] = (() => {
  const main = new Map<string, string | undefined>();
  const regionOf = (lang: string) => {
    if (!main.has(lang)) main.set(lang, new Intl.Locale(lang).maximize().region);
    return main.get(lang);
  };
  const rank = (v: PiperVoice) =>
    (v.region === regionOf(v.lang) ? 10 : 0) + QUALITY.indexOf(v.quality);
  return [...(VOICES as PiperVoice[])].sort(
    (a, b) => a.lang.localeCompare(b.lang) || rank(b) - rank(a) || a.name.localeCompare(b.name),
  );
})();

/** What the runtime does for Piper: find the engine, keep its voices, run it. */
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
  /** A WAV of `text` said by the voice at `lengthScale` (1: as recorded; larger: slower); stopped
   *  when `signal` aborts. */
  run(run: {
    binary: string;
    dir: string;
    id: string;
    text: string;
    lengthScale: number;
    signal?: AbortSignal;
  }): Promise<Uint8Array<ArrayBuffer>>;
}

/** A text read aloud is at most this long (a reply is read in parts). */
export const SAY_MAX = 2000;

export function createReadAloud(deps: { host?: PiperHost; readings?: ReadingCache }) {
  const { host } = deps;
  const kept = keptIn(deps.readings);
  const downloads = createModelDownloads();
  const installed = (v: PiperVoice) => !!host?.voiceDir(v.id);

  /** The voice a profile reads a language with: its choice if installed, else the best installed one. */
  function voiceFor(lang: string, choice: unknown) {
    const ready = PIPER_VOICES.filter((v) => v.lang === lang && installed(v));
    return ready.find((v) => v.id === choice) ?? ready[0];
  }

  return {
    /** The engine (built or not), every voice (each language's best first: its region, then its
     *  quality) and the voice each language is read with unless the profile picks one. */
    state() {
      const voices = PIPER_VOICES.map((v) => ({
        id: v.id,
        lang: v.lang,
        region: v.region,
        name: v.name,
        quality: v.quality,
        bytes: v.bytes,
        installed: installed(v),
        ...downloads.of(v.id),
      }));
      const auto: Record<string, string> = {};
      for (const v of voices) if (v.installed) auto[v.lang] ??= v.id;
      return { engine: !!host?.binary(), voices, auto };
    },

    /** Starts downloading a voice (once); its progress is in `state`. */
    download(id: string) {
      const voice = offered(PIPER_VOICES, id);
      if (!host) throw new ServiceError("speech_unavailable", 409);
      if (installed(voice)) return;
      downloads.start(id, (progress, signal) =>
        host.download(`${VOICE_URL}vits-piper-${voice.id}.tar.bz2`, voice, progress, signal),
      );
    },

    /** Removes a voice (stopping a download of it). */
    remove(id: string) {
      offered(PIPER_VOICES, id);
      downloads.cancel(id);
      host?.remove(id);
    },

    /** Whether a language can be read with Piper (the engine built and a voice installed). */
    canRead: (lang: string) => !!host?.binary() && !!voiceFor(lang, undefined),

    /** The voice a language is read with — the profile's choice if installed, else the best one —
     *  when Piper can read it. */
    voice: (lang: string, choice: unknown) =>
      host?.binary() ? voiceFor(lang, choice)?.id : undefined,

    /** A WAV of a text in a language, with the profile's voice and speed (0.5–1.5); kept in the
     *  readings' cache unless `keep` is false (a deck's words: kept in the deck's folder instead).
     *  `signal`: the request gone — the reading stops unless another request waits for it too. */
    async say(
      text: string,
      lang: string,
      choice: unknown,
      rate: number,
      keep = true,
      signal?: AbortSignal,
    ) {
      const binary = host?.binary();
      const voice = voiceFor(lang, choice);
      const dir = voice && host?.voiceDir(voice.id);
      if (!host || !binary || !voice || !dir) throw new ServiceError("speech_unavailable", 409);
      const lengthScale = Math.round((1 / rate) * 100) / 100;
      const key = await sha256(`${voice.id}\n${lengthScale}\n${text}`);
      const run = (stop?: AbortSignal) =>
        host.run({ binary, dir, id: voice.id, text, lengthScale, signal: stop });
      return (keep ? kept(key, run, signal) : run(signal)).catch((error: unknown) => {
        if (signal?.aborted) throw error;
        console.error("reading aloud:", error);
        throw new ServiceError("speech_engine_failed", 502);
      });
    },
  };
}
export type ReadAloud = ReturnType<typeof createReadAloud>;
