// Reading aloud with Qwen3-TTS on this machine: qwentts.cpp's `tts-server` (built in
// native/qwen), run by the sidecar supervisor like whisper-server with a model — a talker and the
// codec it shares with the others, GGUF from Hugging Face at a fixed commit, checked against their
// sha256 — and asked for a text in a language with one of its named speakers. Words are read by the
// Base model in a voice cloned from a recording (word-voice.ts chooses it; owner, 2026-10-15): a
// second process of its own, so reading a word never unloads the model practice is read with. A
// reading is kept with Piper's (one cache), so a text read again comes at once.
import { ServiceError } from "../errors.ts";
import { base64, sha256 } from "../security/encoding.ts";
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
/** The speaker of a language the learner picked none for. */
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
 *  speaks on an M2 Pro) and the large one; the large is used when both are there (on a phone the
 *  small). */
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
/** The Base model, which clones a voice from a recording: words read by a native voice (the named
 *  speakers have no German one, and ran on with babble after single words). */
const WORD_MODEL: ModelFile = {
  id: "base",
  file: "qwen-talker-1.7b-base-Q8_0.gguf",
  bytes: 2_079_448_256,
  sha256: "4b9a33a236908dd9435a42f7a396e38038329d053b704342a6413c08544c4fda",
};
const ALL_MODELS = [...QWEN_MODELS, WORD_MODEL];
const MODEL_URL =
  "https://huggingface.co/Serveurperso/Qwen3-TTS-GGUF/resolve/b7ee2e8c7459c3bea99da23e3d178125a7d1713c/";

/** Loading the small model takes about 20 s on an M2 Pro; slower machines get more. */
const START_MS = 180_000;
/** The engine stops after this long without a request (it holds about 3 GB). */
const IDLE_MS = 10 * 60_000;
/** The Base model reads a word now and then: let go sooner. */
const WORDS_IDLE_MS = 3 * 60_000;
/** A reply's piece is read in a few seconds; an engine that takes longer is stuck. */
const SAY_MS = 120_000;
/** Same text, same speech: sampling is seeded, so a reading kept is the one it would make again. */
const SEED = 42;
/** The engine's own limit of codec frames a reading makes. */
const ENGINE_MAX_TOKENS = 2048;
/** The codec's frames a second. */
const FRAMES_PER_S = 12.5;

/**
 * The most codec frames a text may take: twice what it takes to say at an unhurried pace — 0.08 s a
 * letter, 0.45 s a digit (said as a word), 0.3 s a character of the scripts whose characters are
 * syllables or words — and 2 s more. A line is never cut; a word that runs on with babble stops after
 * a few seconds, never half a minute (owner, 2026-10-15).
 */
export function maxTokens(text: string) {
  const all = [...text].length;
  const digits = text.match(/\p{Nd}/gu)?.length ?? 0;
  const syllabic =
    text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)
      ?.length ?? 0;
  const said = 0.08 * (all - digits - syllabic) + 0.45 * digits + 0.3 * syllabic;
  return Math.min(ENGINE_MAX_TOKENS, Math.ceil(FRAMES_PER_S * (2 + 2 * said)));
}

/** A voice cloned for words: its id (a new recording or transcript is a new voice), what the
 *  recording says, the recording (24 kHz mono WAV). */
export interface ClonedVoice {
  id: string;
  text: string;
  wav: Uint8Array;
}

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
  /** The model's state as Settings shows it: its size (with the codec while that is missing too),
   *  installed, its download. */
  const stateOf = (m: ModelFile) => ({
    id: m.id,
    bytes: downloads.total(m.id) ?? m.bytes + (installed(m) || there(CODEC) ? 0 : CODEC.bytes),
    installed: installed(m),
    ...downloads.of(m.id),
  });
  /** The model in use: the profile's choice when it is there, else the large one when it is there —
   *  on a phone the small one (its default). */
  const inUse = (choice?: unknown) => {
    const ready = QWEN_MODELS.filter(installed);
    return ready.find((m) => m.id === choice) ?? (host?.phone ? ready[0] : ready.at(-1));
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
  /** The voices registered with the Base model's process running now (none after a start). */
  let registered = new Map<string, Promise<void>>();
  const wordEngine = engineSidecar(host, {
    spawn: (h, _id, port) => {
      const program = binary();
      const talker = there(WORD_MODEL);
      const codec = there(CODEC);
      if (!h.qwen || !program || !talker || !codec)
        throw new ServiceError("speech_unavailable", 409);
      return h.qwen.spawn(program, { talker, codec }, port);
    },
    fetch: deps.fetch,
    startMs: START_MS,
    idleMs: WORDS_IDLE_MS,
    started: () => {
      registered = new Map();
    },
  });
  /** The voice registered with the process at `url` (once a run: it forgets them when it stops). */
  const register = (url: string, voice: ClonedVoice) => {
    const name = voiceName(voice);
    let done = registered.get(name);
    if (!done) {
      const mine = registered;
      done = deps
        .fetch(`${url}/v1/audio/voices`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, ref_text: voice.text, wav_b64: base64(voice.wav) }),
          signal: AbortSignal.timeout(SAY_MS),
        })
        .catch(() => undefined)
        .then((res) => {
          // The engine refused the recording: no fault of the engine, which stays loaded.
          if (res && res.status >= 400 && res.status < 500)
            throw new ServiceError("unsupported_audio", 422);
          if (!res?.ok) throw new ServiceError("speech_engine_failed", 502);
        });
      // One that failed is asked again next time.
      done.catch(() => mine.delete(name));
      mine.set(name, done);
    }
    return done;
  };
  /** A text said by the process at `url` as a WAV: `body` its voice and language. */
  const speak = async (url: string, text: string, body: object, stop?: AbortSignal) => {
    const res = await deps
      .fetch(`${url}/v1/audio/speech`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: text,
          ...body,
          response_format: "wav",
          seed: SEED,
          max_new_tokens: maxTokens(text),
        }),
        signal: stop
          ? AbortSignal.any([AbortSignal.timeout(SAY_MS), stop])
          : AbortSignal.timeout(SAY_MS),
      })
      .catch(() => undefined);
    if (!res?.ok) throw new ServiceError("speech_engine_failed", 502);
    return new Uint8Array(await res.arrayBuffer());
  };

  return {
    /** The engine (built or not), each model (installed, downloading, failed, the one in use with the
     *  profile's `choice`), what it speaks. */
    state(choice?: unknown) {
      return {
        engine: !!binary(),
        models: QWEN_MODELS.map((m) => ({ ...stateOf(m), inUse: inUse(choice)?.id === m.id })),
        /** The Base model, which reads words in a cloned voice. */
        wordModel: stateOf(WORD_MODEL),
        languages: Object.keys(QWEN_LANGUAGES),
        speakers: [...QWEN_SPEAKERS],
        /** The speaker unless the learner picks one. */
        defaultSpeaker: DEFAULT_SPEAKER,
      };
    },

    /** Starts downloading a model with the codec when it is not there yet (once; the codec once for
     *  all the models); its progress is in `state`. */
    download(id: string) {
      const model = offered(ALL_MODELS, id);
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
      const model = offered(ALL_MODELS, id);
      downloads.cancel(id);
      if (engine.setup() === id) engine.stop();
      if (wordEngine.setup() === id) wordEngine.stop();
      host?.models.remove(model.file);
      const needed = ALL_MODELS.some((m) => m.id !== id && (!!there(m) || downloads.going(m.id)));
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

    /** Starts the Base model ahead of reading words (loading it takes seconds). */
    warmWords() {
      if (binary() && installed(WORD_MODEL)) wordEngine.warm(WORD_MODEL.id);
    },

    /** Whether words in a language can be read here in a cloned voice: the Base model there. */
    canClone: (lang: string) => !!binary() && installed(WORD_MODEL) && lang in QWEN_LANGUAGES,

    /** A WAV of a text in its one language said by the Base model in a cloned voice (registered with
     *  its process as needed). Kept in the readings' cache unless `keep` is false. */
    async sayCloned(
      text: string,
      lang: string,
      voice: ClonedVoice,
      { keep = true, signal }: { keep?: boolean; signal?: AbortSignal } = {},
    ) {
      const language = QWEN_LANGUAGES[lang];
      if (!binary() || !installed(WORD_MODEL) || !language)
        throw new ServiceError("speech_unavailable", 409);
      const key = await sha256(`qwen-clone\n${voice.id}\n${language}\n${text}`);
      const read = (stop?: AbortSignal) =>
        wordEngine.use(WORD_MODEL.id, async (url) => {
          await register(url, voice);
          return speak(url, text, { voice: voiceName(voice), language }, stop);
        });
      return keep ? kept(key, read, signal) : read(signal);
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

    /** A WAV of a text in its one language (given, never detected), said with the profile's model by
     *  its speaker (else the default one). Kept in the readings' cache unless `keep` is false (a
     *  deck's words: kept in the deck's folder instead). */
    async say(
      text: string,
      lang: string,
      choice: unknown,
      modelChoice?: unknown,
      { keep = true, signal }: { keep?: boolean; signal?: AbortSignal } = {},
    ) {
      const model = inUse(modelChoice);
      if (!binary() || !model || !QWEN_LANGUAGES[lang])
        throw new ServiceError("speech_unavailable", 409);
      const language = QWEN_LANGUAGES[lang] as string;
      const speaker = speakerOf(choice);
      const key = await sha256(`qwen\n${model.id}\n${speaker}\n${language}\n${text}`);
      const read = (stop?: AbortSignal) =>
        engine.use(model.id, (url) => speak(url, text, { voice: speaker, language }, stop));
      return keep ? kept(key, read, signal) : read(signal);
    },
  };
}
export type QwenTts = ReturnType<typeof createQwenTts>;

/** The name a cloned voice is registered by (the engine lowercases names). */
const voiceName = (voice: ClonedVoice) => `words-${voice.id}`;
