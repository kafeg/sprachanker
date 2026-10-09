// Reading aloud with Qwen3-TTS on this machine (08): qwentts.cpp's `tts-server` (built in
// native/qwen), run by the sidecar supervisor like whisper-server with a model — a talker and the
// codec it shares with the others, GGUF from Hugging Face at a fixed commit, checked against their
// sha256 — and asked for a text in a language with one of its named speakers. A reading is kept with
// Piper's (one cache), so a text read again comes at once.
import { ServiceError } from "../errors.ts";
import { sha256 } from "../security/encoding.ts";
import type { PiperHost } from "./read-aloud.ts";
import { createSidecar } from "./sidecar.ts";
import type { ModelFile, SpeechHost } from "./speech.ts";

/** The languages Qwen3-TTS speaks, by code, with the name its server takes. */
export const QWEN_LANGUAGES: Record<string, string> = {
  de: "German",
  en: "English",
  ru: "Russian",
  fr: "French",
  es: "Spanish",
  it: "Italian",
  pt: "Portuguese",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
};
/** Its named speakers (the CustomVoice models); each speaks every language. */
export const QWEN_SPEAKERS = [
  "ryan",
  "aiden",
  "serena",
  "vivian",
  "uncle_fu",
  "eric",
  "dylan",
  "ono_anna",
  "sohee",
] as const;
/** The speaker unless the learner picks one: one voice for every language, as a chosen one is. */
export const DEFAULT_SPEAKER = "ryan";

const CODEC: ModelFile = {
  id: "codec",
  file: "qwen-tokenizer-12hz-Q8_0.gguf",
  bytes: 291_150_624,
  sha256: "1883beeed99348fc35e23dd225e9082f93f6f8c109330a33d935baa8acdbfd94",
};
/** The models offered: the small one (about 3 GB of memory while it runs, reads twice as fast as it
 *  speaks on an M2 Pro) and the large one; the large is used when both are there. */
export const QWEN_MODELS: ModelFile[] = [
  {
    id: "0.6b",
    file: "qwen-talker-0.6b-customvoice-Q8_0.gguf",
    bytes: 968_588_544,
    sha256: "4eb38675c736ed6ac72012846ac8d6ef80e5af8bc05726870f0b3a6569588519",
  },
  {
    id: "1.7b",
    file: "qwen-talker-1.7b-customvoice-Q8_0.gguf",
    bytes: 2_042_834_304,
    sha256: "cab2cff67a0a557310febe558dc83076b28ed790e491867eb2751759f4cd89fa",
  },
];
const MODEL_URL =
  "https://huggingface.co/Serveurperso/Qwen3-TTS-GGUF/resolve/b7ee2e8c7459c3bea99da23e3d178125a7d1713c/";

/** Loading the small model takes about 20 s on an M2 Pro; slower machines get more. */
const START_MS = 180_000;
/** The engine stops after this long without a request (it holds about 3 GB). */
const IDLE_MS = 10 * 60_000;
/** A reply's piece is read in a few seconds; an engine that takes longer is stuck. */
const SAY_MS = 120_000;
/** Same text, same speech: sampling is seeded, so a reading kept is the one it would make again. */
const SEED = 42;

export function createQwenTts(deps: {
  host?: SpeechHost;
  cache?: Pick<PiperHost, "kept">;
  fetch: typeof fetch;
}) {
  const { host } = deps;
  /** The codec's download, one for every model's that needs it; stopped only when none still does. */
  type CodecDownload = {
    promise: Promise<void>;
    controller: AbortController;
    done: number;
    users: number;
  };
  let codec: CodecDownload | undefined;
  /** Each model's download: bytes done of `total` (with the codec when it came along; while it waits
   *  for the codec, the codec's). */
  const downloads = new Map<
    string,
    {
      done: number;
      total: number;
      controller: AbortController;
      codec?: CodecDownload;
      error?: string;
    }
  >();
  const fetchCodec = (h: SpeechHost) => {
    if (!codec) {
      const controller = new AbortController();
      const c = { controller, done: 0, users: 0, promise: Promise.resolve() };
      c.promise = h.models
        .download(`${MODEL_URL}${CODEC.file}`, CODEC, (n) => (c.done = n), controller.signal)
        .finally(() => {
          if (codec === c) codec = undefined;
        });
      codec = c;
    }
    return codec;
  };
  const modelOf = (id: string) => {
    const model = QWEN_MODELS.find((m) => m.id === id);
    if (!model) throw new ServiceError("no_such_model", 404);
    return model;
  };
  const there = (m: ModelFile) => host?.models.path(m.file, m.bytes);
  const installed = (m: ModelFile) => !!there(m) && !!there(CODEC);
  /** The model in use: the profile's choice when it is there, else the large one when it is there. */
  const inUse = (choice?: unknown) => {
    const ready = QWEN_MODELS.filter(installed);
    return ready.find((m) => m.id === choice) ?? ready.at(-1);
  };
  const engine = createSidecar({
    spawn: (id, port) => {
      const binary = host?.qwenBinary();
      const talker = there(modelOf(id));
      const codec = there(CODEC);
      if (!host || !binary || !talker || !codec) throw new ServiceError("speech_unavailable", 409);
      return host.spawnQwen(binary, talker, codec, port);
    },
    freePort: () => (host ? host.freePort() : Promise.reject(new Error("no speech host"))),
    fetch: deps.fetch,
    failed: "speech_engine_failed",
    startMs: START_MS,
    idleMs: IDLE_MS,
  });
  const ready = () => !!host?.qwenBinary() && !!inUse();

  return {
    /** The engine (built or not), each model (installed, downloading, failed, the one in use with the
     *  profile's `choice`), what it speaks. */
    state(choice?: unknown) {
      const codecMissing = there(CODEC) ? 0 : CODEC.bytes;
      return {
        engine: !!host?.qwenBinary(),
        models: QWEN_MODELS.map((m) => {
          const d = downloads.get(m.id);
          return {
            id: m.id,
            bytes: d && !d.error ? d.total : m.bytes + (installed(m) ? 0 : codecMissing),
            installed: installed(m),
            inUse: inUse(choice)?.id === m.id,
            ...(d && !d.error && { downloaded: d.codec ? d.codec.done : d.done }),
            ...(d?.error && { error: d.error }),
          };
        }),
        languages: Object.keys(QWEN_LANGUAGES),
        speakers: [...QWEN_SPEAKERS],
        /** The speaker unless the learner picks one. */
        defaultSpeaker: DEFAULT_SPEAKER,
      };
    },

    /** Starts downloading a model with the codec when it is not there yet (once; the codec once for
     *  both models); its progress is in `state`. */
    download(id: string) {
      const model = modelOf(id);
      if (!host) throw new ServiceError("speech_unavailable", 409);
      if (installed(model) || (downloads.has(id) && !downloads.get(id)?.error)) return;
      const withCodec = !there(CODEC);
      const entry: NonNullable<ReturnType<typeof downloads.get>> = {
        done: 0,
        total: model.bytes + (withCodec ? CODEC.bytes : 0),
        controller: new AbortController(),
      };
      downloads.set(id, entry);
      const { signal } = entry.controller;
      (async () => {
        if (withCodec && !there(CODEC)) {
          const c = fetchCodec(host);
          c.users++;
          entry.codec = c;
          try {
            await new Promise<void>((resolve, reject) => {
              c.promise.then(resolve, reject);
              signal.addEventListener("abort", () => reject(new Error("cancelled")), {
                once: true,
              });
            });
          } finally {
            entry.codec = undefined;
            if (--c.users === 0 && signal.aborted) c.controller.abort();
          }
        }
        const before = withCodec ? CODEC.bytes : 0;
        if (!there(model))
          await host.models.download(
            `${MODEL_URL}${model.file}`,
            model,
            (n) => (entry.done = before + n),
            signal,
          );
      })()
        .then(() => downloads.delete(id))
        .catch((error: unknown) => {
          entry.error = signal.aborted ? "cancelled" : String(error).slice(0, 200);
        });
    },

    /** Removes a model (stopping a download of it, or the engine running it); the codec goes with the
     *  last one — kept while another model has its talker or is being downloaded. */
    remove(id: string) {
      const model = modelOf(id);
      downloads.get(id)?.controller.abort();
      downloads.delete(id);
      if (engine.setup() === id) engine.stop();
      host?.models.remove(model.file);
      const needed = QWEN_MODELS.some(
        (m) => m.id !== id && (!!there(m) || (downloads.has(m.id) && !downloads.get(m.id)?.error)),
      );
      if (!needed) {
        codec?.controller.abort();
        host?.models.remove(CODEC.file);
      }
    },

    /** Starts the engine ahead of reading with the profile's model (loading it takes seconds). */
    warm(choice?: unknown) {
      const model = inUse(choice);
      if (model && host?.qwenBinary()) engine.warm(model.id);
    },

    /** Whether a language can be read with Qwen3-TTS here. */
    canRead: (lang: string) => ready() && lang in QWEN_LANGUAGES,

    /** A WAV of a text in a language, said with the profile's model by its speaker (else the default
     *  one). `mixed`: the text mixes languages, read whole with the model telling them apart
     *  ("auto"), never cut into each language's pieces. */
    async say(text: string, lang: string, choice: unknown, modelChoice?: unknown, mixed = false) {
      const model = inUse(modelChoice);
      if (!host?.qwenBinary() || !model || !QWEN_LANGUAGES[lang])
        throw new ServiceError("speech_unavailable", 409);
      const language = mixed ? "auto" : (QWEN_LANGUAGES[lang] as string);
      const speaker = QWEN_SPEAKERS.find((s) => s === choice) ?? DEFAULT_SPEAKER;
      const make = () =>
        engine.use(model.id, async (url) => {
          const res = await deps
            .fetch(`${url}/v1/audio/speech`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                input: text,
                voice: speaker,
                language,
                response_format: "wav",
                seed: SEED,
              }),
              signal: AbortSignal.timeout(SAY_MS),
            })
            .catch(() => undefined);
          if (!res?.ok) throw new ServiceError("speech_engine_failed", 502);
          return new Uint8Array(await res.arrayBuffer());
        });
      const key = await sha256(`qwen\n${model.id}\n${speaker}\n${language}\n${text}`);
      return deps.cache ? deps.cache.kept(key, make) : make();
    },
  };
}
export type QwenTts = ReturnType<typeof createQwenTts>;
