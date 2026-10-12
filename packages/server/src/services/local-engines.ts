// What the speech engines on this machine share: what the runtime does for them (SpeechHost:
// their programs, model files, readings kept), the supervisor of one run on a local port, a model or
// voice looked up by id. Their downloads: model-downloads.ts.
import type { ErrorCode } from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import { createSidecar, type SidecarProcess } from "./sidecar.ts";

/** A model file downloaded into <data-root>/models and checked against its sha256. */
export interface ModelFile {
  id: string;
  file: string;
  bytes: number;
  sha256: string;
}

/** Model files in <data-root>/models. */
export interface ModelStore {
  /** The model file's path, if it is there whole. */
  path(file: string, bytes: number): string | undefined;
  /** Downloads a model (to a part file, checked, then renamed); `onProgress` gets the bytes so far. */
  download(
    url: string,
    model: ModelFile,
    onProgress: (bytes: number) => void,
    signal: AbortSignal,
  ): Promise<void>;
  remove(file: string): void;
}

/** An engine built in native/ and run on a local port with its model files. */
interface LocalEngine<Files> {
  /** Its program, if it was built. */
  binary(): string | undefined;
  spawn(binary: string, files: Files, port: number): SidecarProcess;
}

/** What the runtime does for the engines the sidecar supervisor runs: whisper-server, Qwen3-TTS's
 *  tts-server (an engine left out is not built here). */
export interface SpeechHost {
  /** A free port on 127.0.0.1. */
  freePort(): Promise<number>;
  models: ModelStore;
  whisper?: LocalEngine<{ model: string }>;
  qwen?: LocalEngine<{ talker: string; codec: string }>;
}

/** Readings kept in <data-root>/cache/tts, any engine's: by key (the engine, its voice, speed and the
 *  text, hashed). */
export interface ReadingCache {
  /** From the cache, else made by `produce` once (a second request for it waits for the first) and
   *  kept. A request whose `signal` aborts stops waiting; once every request waiting for it has, the
   *  making is stopped (`produce`'s signal). */
  kept(
    key: string,
    produce: (signal: AbortSignal) => Promise<Uint8Array<ArrayBuffer>>,
    signal?: AbortSignal,
  ): Promise<Uint8Array<ArrayBuffer>>;
}

/** A reading kept when there is a cache, else made each time (stopped when `signal` aborts). */
export const keptIn =
  (cache: ReadingCache | undefined) =>
  (
    key: string,
    produce: (signal: AbortSignal) => Promise<Uint8Array<ArrayBuffer>>,
    signal: AbortSignal = new AbortController().signal,
  ) =>
    cache ? cache.kept(key, produce, signal) : produce(signal);

/** What is offered with this id (a model, a voice); 404 when nothing is. */
export function offered<T extends { id: string }>(list: readonly T[], id: string): T {
  const found = list.find((m) => m.id === id);
  if (!found) throw new ServiceError("no_such_model", 404);
  return found;
}

/** An engine of the host run by the sidecar supervisor: one process for a setup (a model);
 *  `speech_unavailable` without a host, `speech_engine_failed` when it does not answer. */
export function engineSidecar(
  host: SpeechHost | undefined,
  options: {
    spawn(host: SpeechHost, setup: string, port: number): SidecarProcess;
    fetch: typeof fetch;
    startMs: number;
    idleMs: number;
  },
) {
  const unavailable = () => new ServiceError("speech_unavailable", 409);
  return createSidecar({
    spawn: (setup, port) => {
      if (!host) throw unavailable();
      return options.spawn(host, setup, port);
    },
    freePort: () => (host ? host.freePort() : Promise.reject(unavailable())),
    fetch: options.fetch,
    failed: "speech_engine_failed" satisfies ErrorCode,
    startMs: options.startMs,
    idleMs: options.idleMs,
  });
}
