// Speech recognition on this machine (08; 06, "Sidecars"): whisper.cpp's `whisper-server`, run by the
// sidecar supervisor with the chosen model; the models it can use, downloaded from a pinned commit and
// checked against their sha256. One server-wide engine: each profile chooses whether to use it and
// which installed model (settings); a transcription has a time limit.
import { ServiceError } from "../errors.ts";
import type { Settings } from "./settings.ts";
import { createSidecar } from "./sidecar.ts";

export interface WhisperModel {
  id: string;
  file: string;
  bytes: number;
  sha256: string;
}

/** The models offered, best first: the large turbo model (quantised), and a small one for slower
 *  machines. From ggerganov/whisper.cpp on Hugging Face at a fixed commit. */
export const WHISPER_MODELS: WhisperModel[] = [
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

/** What the runtime does for speech: find the engine, run it, keep its models. */
export interface SpeechHost {
  /** The `whisper-server` binary, if it was built (native/). */
  whisperBinary(): string | undefined;
  /** A free port on 127.0.0.1. */
  freePort(): Promise<number>;
  /** Starts the engine on that port with a model file. */
  spawnWhisper(
    binary: string,
    model: string,
    port: number,
  ): { exited: Promise<number>; kill(): void };
  models: {
    /** The model file's path, if it is there whole. */
    path(file: string, bytes: number): string | undefined;
    /** Downloads a model (to a part file, checked, then renamed); `onProgress` gets the bytes so far. */
    download(
      url: string,
      model: WhisperModel,
      onProgress: (bytes: number) => void,
      signal: AbortSignal,
    ): Promise<void>;
    remove(file: string): void;
  };
}

/** The engine stops after this long without a request (it holds the model in memory). */
const IDLE_MS = 10 * 60_000;
/** Loading the large model takes about 15 s on an M2; slower machines get more. */
const START_MS = 120_000;
/** A 30 s take is heard in a few seconds; an engine that takes longer is stuck. */
const TRANSCRIBE_MS = 60_000;

export function createSpeech(deps: { host?: SpeechHost; fetch: typeof fetch }) {
  const { host } = deps;
  const downloads = new Map<
    string,
    { done: number; controller: AbortController; error?: string }
  >();
  const modelOf = (id: string) => {
    const model = WHISPER_MODELS.find((m) => m.id === id);
    if (!model) throw new ServiceError("no_such_model", 404);
    return model;
  };
  const installed = (m: WhisperModel) => !!host?.models.path(m.file, m.bytes);
  /** Course recordings heard, by model, language and recording. */
  const heard = new Map<string, Promise<string>>();

  /** The model file of an installed model, to run the engine with. */
  const fileOf = (id: string) => {
    const model = modelOf(id);
    const file = host?.models.path(model.file, model.bytes);
    if (!host?.whisperBinary() || !file) throw new ServiceError("speech_unavailable", 409);
    return file;
  };
  const engine = createSidecar({
    spawn: (id, port) => {
      const binary = host?.whisperBinary();
      if (!host || !binary) throw new ServiceError("speech_unavailable", 409);
      return host.spawnWhisper(binary, fileOf(id), port);
    },
    freePort: () => (host ? host.freePort() : Promise.reject(new Error("no speech host"))),
    fetch: deps.fetch,
    failed: "speech_engine_failed",
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
        engine: !!host?.whisperBinary(),
        models: WHISPER_MODELS.map((m) => {
          const d = downloads.get(m.id);
          return {
            id: m.id,
            bytes: m.bytes,
            installed: installed(m),
            ...(d && !d.error && { downloaded: d.done }),
            ...(d?.error && { error: d.error }),
          };
        }),
      };
    },

    /** The model a profile uses: its choice if installed, else the best installed one. */
    modelFor(choice: unknown) {
      const ready = WHISPER_MODELS.filter(installed);
      return (ready.find((m) => m.id === choice) ?? ready[0])?.id;
    },

    /** Starts downloading a model (once); its progress is in `state`. */
    download(id: string) {
      const model = modelOf(id);
      if (!host) throw new ServiceError("speech_unavailable", 409);
      if (installed(model) || (downloads.has(id) && !downloads.get(id)?.error)) return;
      const entry = { done: 0, controller: new AbortController() } as {
        done: number;
        controller: AbortController;
        error?: string;
      };
      downloads.set(id, entry);
      host.models
        .download(
          `${MODEL_URL}${model.file}`,
          model,
          (n) => (entry.done = n),
          entry.controller.signal,
        )
        .then(() => downloads.delete(id))
        .catch((error: unknown) => {
          entry.error = entry.controller.signal.aborted ? "cancelled" : String(error).slice(0, 200);
        });
    },

    /** Removes a model (stopping a download of it, or the engine running it). */
    remove(id: string) {
      const model = modelOf(id);
      downloads.get(id)?.controller.abort();
      downloads.delete(id);
      if (engine.setup() === id) engine.stop();
      host?.models.remove(model.file);
    },

    /** Starts the engine ahead of a recording (loading the model takes seconds). */
    warm(model: string) {
      if (installed(modelOf(model)) && host?.whisperBinary()) engine.warm(model);
    },

    transcribe,

    /** What a course's recording says (a question asked, an answer spoken), heard once per model and
     *  kept while the server runs; a failed hearing is not kept. */
    heard(key: string, audio: () => Blob, lang: string, model: string): Promise<string> {
      const id = `${model}\n${lang}\n${key}`;
      let text = heard.get(id);
      if (!text) {
        text = transcribe(audio(), lang, model).then((r) => r.text);
        heard.set(id, text);
        text.catch(() => heard.delete(id));
      }
      return text;
    },

    /** Stops the engine (the server is stopping). */
    close: () => engine.stop(),
  };
}
export type Speech = ReturnType<typeof createSpeech>;

/** The model a profile hears with: its choice while recognition is on and the model is installed. */
export const recogniserOf = (speech: Speech, settings: Settings) =>
  settings.get("speech.recognition") === false
    ? undefined
    : speech.modelFor(settings.get("speech.model"));
