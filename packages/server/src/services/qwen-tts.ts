// Reading aloud with Qwen3-TTS on this machine (08): qwentts.cpp's `tts-server` (built in
// native/qwen), run by the sidecar supervisor like whisper-server with a model — a talker and the
// codec it shares with the others, GGUF from Hugging Face at a fixed commit, checked against their
// sha256 — and asked for a text in a language with one of its named speakers. A reading is kept with
// Piper's (one cache), so a text read again comes at once.
import { ServiceError } from "../errors.ts";
import { sha256 } from "../security/encoding.ts";
import {
  engineSidecar,
  keptIn,
  type ModelFile,
  offered,
  type ReadingCache,
  type SpeechHost,
} from "./local-engines.ts";
import { createModelDownloads, untilAborted } from "./model-downloads.ts";

/** The languages Qwen3-TTS speaks, by code, with the name its server takes. */
const QWEN_LANGUAGES: Record<string, string> = {
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
const QWEN_SPEAKERS = [
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
const DEFAULT_SPEAKER = "ryan";
/** The speaker chosen, else the default one. */
const speakerOf = (choice: unknown) => QWEN_SPEAKERS.find((s) => s === choice) ?? DEFAULT_SPEAKER;

const CODEC: ModelFile = {
  id: "codec",
  file: "qwen-tokenizer-12hz-Q8_0.gguf",
  bytes: 291_150_624,
  sha256: "1883beeed99348fc35e23dd225e9082f93f6f8c109330a33d935baa8acdbfd94",
};
/** The models offered: the small one (about 3 GB of memory while it runs, reads twice as fast as it
 *  speaks on an M2 Pro) and the large one; the large is used when both are there. */
const QWEN_MODELS: ModelFile[] = [
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
  readings?: ReadingCache;
  fetch: typeof fetch;
}) {
  const { host } = deps;
  const binary = () => host?.qwen?.binary();
  const kept = keptIn(deps.readings);
  /** The codec's download, one for every model's that needs it (each told its bytes); stopped only
   *  when none still waits for it. */
  type CodecDownload = {
    promise: Promise<void>;
    controller: AbortController;
    watchers: Set<(bytes: number) => void>;
  };
  let codec: CodecDownload | undefined;
  const fetchCodec = (h: SpeechHost) => {
    if (!codec) {
      const controller = new AbortController();
      const c: CodecDownload = { controller, watchers: new Set(), promise: Promise.resolve() };
      c.promise = h.models
        .download(
          `${MODEL_URL}${CODEC.file}`,
          CODEC,
          (n) => {
            for (const watch of c.watchers) watch(n);
          },
          controller.signal,
        )
        .finally(() => {
          if (codec === c) codec = undefined;
        });
      codec = c;
    }
    return codec;
  };
  /** Each model's download: bytes done of all it fetches (with the codec when it comes along). */
  const downloads = createModelDownloads();
  const there = (m: ModelFile) => host?.models.path(m.file, m.bytes);
  const installed = (m: ModelFile) => !!there(m) && !!there(CODEC);
  /** The model in use: the profile's choice when it is there, else the large one when it is there. */
  const inUse = (choice?: unknown) => {
    const ready = QWEN_MODELS.filter(installed);
    return ready.find((m) => m.id === choice) ?? ready.at(-1);
  };
  const engine = engineSidecar(host, {
    spawn: (h, id, port) => {
      const program = binary();
      const talker = there(offered(QWEN_MODELS, id));
      const codec = there(CODEC);
      if (!h.qwen || !program || !talker || !codec)
        throw new ServiceError("speech_unavailable", 409);
      return h.qwen.spawn(program, { talker, codec }, port);
    },
    fetch: deps.fetch,
    startMs: START_MS,
    idleMs: IDLE_MS,
  });
  const ready = () => !!binary() && !!inUse();

  return {
    /** The engine (built or not), each model (installed, downloading, failed, the one in use with the
     *  profile's `choice`), what it speaks. */
    state(choice?: unknown) {
      const codecMissing = there(CODEC) ? 0 : CODEC.bytes;
      return {
        engine: !!binary(),
        models: QWEN_MODELS.map((m) => ({
          id: m.id,
          bytes: downloads.total(m.id) ?? m.bytes + (installed(m) ? 0 : codecMissing),
          installed: installed(m),
          inUse: inUse(choice)?.id === m.id,
          ...downloads.of(m.id),
        })),
        languages: Object.keys(QWEN_LANGUAGES),
        speakers: [...QWEN_SPEAKERS],
        /** The speaker unless the learner picks one. */
        defaultSpeaker: DEFAULT_SPEAKER,
      };
    },

    /** Starts downloading a model with the codec when it is not there yet (once; the codec once for
     *  both models); its progress is in `state`. */
    download(id: string) {
      const model = offered(QWEN_MODELS, id);
      if (!host) throw new ServiceError("speech_unavailable", 409);
      if (installed(model)) return;
      const withCodec = !there(CODEC);
      const before = withCodec ? CODEC.bytes : 0;
      downloads.start(
        id,
        async (progress, signal) => {
          if (withCodec && !there(CODEC)) {
            const c = fetchCodec(host);
            c.watchers.add(progress);
            try {
              await untilAborted(c.promise, signal);
            } finally {
              c.watchers.delete(progress);
              if (c.watchers.size === 0 && signal.aborted) c.controller.abort();
            }
          }
          if (!there(model))
            await host.models.download(
              `${MODEL_URL}${model.file}`,
              model,
              (n) => progress(before + n),
              signal,
            );
        },
        model.bytes + before,
      );
    },

    /** Removes a model (stopping a download of it, or the engine running it); the codec goes with the
     *  last one — kept while another model has its talker or is being downloaded. */
    remove(id: string) {
      const model = offered(QWEN_MODELS, id);
      downloads.cancel(id);
      if (engine.setup() === id) engine.stop();
      host?.models.remove(model.file);
      const needed = QWEN_MODELS.some((m) => m.id !== id && (!!there(m) || downloads.going(m.id)));
      if (!needed) {
        codec?.controller.abort();
        host?.models.remove(CODEC.file);
      }
    },

    /** Starts the engine ahead of reading with the profile's model (loading it takes seconds). */
    warm(choice?: unknown) {
      const model = inUse(choice);
      if (model && binary()) engine.warm(model.id);
    },

    /** Whether a language can be read with Qwen3-TTS here. */
    canRead: (lang: string) => ready() && lang in QWEN_LANGUAGES,

    /** The model and speaker a language is read with (the profile's choices, else the large model
     *  there and the default speaker), when Qwen3-TTS can read it. */
    voice(lang: string, choice: unknown, modelChoice?: unknown) {
      const model = inUse(modelChoice);
      if (!binary() || !model || !QWEN_LANGUAGES[lang]) return undefined;
      return { model: model.id, speaker: speakerOf(choice) };
    },

    /** A WAV of a text in a language, said with the profile's model by its speaker (else the default
     *  one). `mixed`: the text mixes languages, read whole with the model telling them apart
     *  ("auto"), never cut into each language's pieces. Kept in the readings' cache unless `keep` is
     *  false (a deck's words: kept in the deck's folder instead). */
    async say(
      text: string,
      lang: string,
      choice: unknown,
      modelChoice?: unknown,
      { mixed = false, keep = true } = {},
    ) {
      const model = inUse(modelChoice);
      if (!binary() || !model || !QWEN_LANGUAGES[lang])
        throw new ServiceError("speech_unavailable", 409);
      const language = mixed ? "auto" : (QWEN_LANGUAGES[lang] as string);
      const speaker = speakerOf(choice);
      const key = await sha256(`qwen\n${model.id}\n${speaker}\n${language}\n${text}`);
      const read = () =>
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
      return keep ? kept(key, read) : read();
    },
  };
}
export type QwenTts = ReturnType<typeof createQwenTts>;
