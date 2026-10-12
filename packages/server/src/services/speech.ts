// Speech recognition on this machine (08; 06, "Sidecars"): whisper.cpp's `whisper-server`, run by the
// sidecar supervisor with the chosen model; the models it can use, downloaded from a pinned commit and
// checked against their sha256. One server-wide engine: each profile chooses whether to use it and
// which installed model (settings, profile-speech.ts); a transcription has a time limit.
import { ServiceError } from "../errors.ts";
import { createOnce } from "../once.ts";
import { engineSidecar, type ModelFile, offered, type SpeechHost } from "./local-engines.ts";
import { createModelDownloads } from "./model-downloads.ts";
import { loudness, madeUp, silent } from "./silence.ts";

/** The models offered, best first: the large turbo model (quantised), and a small one for slower
 *  machines. From ggerganov/whisper.cpp on Hugging Face at a fixed commit. */
const WHISPER_MODELS: ModelFile[] = [
  {
    id: "large-v3-turbo-q5_0",
    file: "ggml-large-v3-turbo-q5_0.bin",
    bytes: 574_041_195,
    sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
  },
  {
    id: "small-q5_1",
    file: "ggml-small-q5_1.bin",
    bytes: 190_085_487,
    sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb",
  },
];
const MODEL_URL =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/";

/** The engine stops after this long without a request (it holds the model in memory). */
const IDLE_MS = 10 * 60_000;
/** Loading the large model takes about 15 s on an M2; slower machines get more. */
const START_MS = 120_000;
/** A 30 s take is heard in a few seconds; an engine that takes longer is stuck. */
const TRANSCRIBE_MS = 60_000;

export function createSpeech(deps: { host?: SpeechHost; fetch: typeof fetch }) {
  const { host } = deps;
  const binary = () => host?.whisper?.binary();
  const downloads = createModelDownloads();
  const installed = (m: ModelFile) => !!host?.models.path(m.file, m.bytes);
  /** Course recordings heard, by model, language and recording; a failed hearing is not kept. */
  const heard = createOnce<string>({ keep: true });

  /** The model file of an installed model, to run the engine with. */
  const fileOf = (id: string) => {
    const model = offered(WHISPER_MODELS, id);
    const file = host?.models.path(model.file, model.bytes);
    if (!binary() || !file) throw new ServiceError("speech_unavailable", 409);
    return file;
  };
  const engine = engineSidecar(host, {
    spawn: (h, id, port) => {
      const program = binary();
      if (!h.whisper || !program) throw new ServiceError("speech_unavailable", 409);
      return h.whisper.spawn(program, { model: fileOf(id) }, port);
    },
    fetch: deps.fetch,
    startMs: START_MS,
    idleMs: IDLE_MS,
  });

  /** What was said in a recording (a 16 kHz mono WAV, or a course's MP3), in a language given
   *  (never detected, 08). */
  async function transcribe(audio: Blob, lang: string, model: string) {
    const started = Date.now();
    fileOf(model);
    const text = await engine.use(model, async (url) => {
      const form = new FormData();
      form.set("file", audio, "speech");
      form.set("language", lang);
      form.set("response_format", "json");
      form.set("temperature", "0");
      const res = await deps
        .fetch(`${url}/inference`, {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(TRANSCRIBE_MS),
        })
        .catch(() => undefined);
      const body = res?.ok ? await res.json().catch(() => undefined) : undefined;
      if (!body) throw new ServiceError("speech_engine_failed", 502);
      return String((body as { text?: unknown }).text ?? "");
    });
    return { text: text.trim(), ms: Date.now() - started };
  }

  return {
    /** The engine (built or not) and each model: installed, downloading, failed. */
    state() {
      return {
        engine: !!binary(),
        models: WHISPER_MODELS.map((m) => ({
          id: m.id,
          bytes: m.bytes,
          installed: installed(m),
          ...downloads.of(m.id),
        })),
      };
    },

    /** The model a profile uses: its choice if installed, else the best installed one. */
    modelFor(choice: unknown) {
      const ready = WHISPER_MODELS.filter(installed);
      return (ready.find((m) => m.id === choice) ?? ready[0])?.id;
    },

    /** Starts downloading a model (once); its progress is in `state`. */
    download(id: string) {
      const model = offered(WHISPER_MODELS, id);
      if (!host) throw new ServiceError("speech_unavailable", 409);
      if (installed(model)) return;
      downloads.start(id, (progress, signal) =>
        host.models.download(`${MODEL_URL}${model.file}`, model, progress, signal),
      );
    },

    /** Removes a model (stopping a download of it, or the engine running it). */
    remove(id: string) {
      const model = offered(WHISPER_MODELS, id);
      downloads.cancel(id);
      if (engine.setup() === id) engine.stop();
      host?.models.remove(model.file);
    },

    /** Starts the engine ahead of a recording (loading the model takes seconds). */
    warm(model: string) {
      if (installed(offered(WHISPER_MODELS, model)) && binary()) engine.warm(model);
    },

    transcribe,

    /** What the learner said in a take (a 16 kHz WAV): nothing when nothing in it was loud enough to
     *  be speech (the engine not asked), nor when a near-silent take comes back as a phrase the
     *  recogniser makes up of silence ("Vielen Dank.", "Untertitel …"). */
    async take(wav: Uint8Array<ArrayBuffer>, lang: string, model: string) {
      const sound = loudness(wav);
      if (sound && silent(sound)) return { text: "", ms: 0 };
      const heard = await transcribe(new Blob([wav], { type: "audio/wav" }), lang, model);
      return sound && madeUp(sound, heard.text, lang) ? { ...heard, text: "" } : heard;
    },

    /** What a course's recording says (a question asked, an answer spoken), heard once per model and
     *  kept while the server runs; a failed hearing is not kept. */
    heard: (key: string, audio: () => Blob, lang: string, model: string): Promise<string> =>
      heard(`${model}\n${lang}\n${key}`, () =>
        transcribe(audio(), lang, model).then((r) => r.text),
      ),
  };
}
export type Speech = ReturnType<typeof createSpeech>;
