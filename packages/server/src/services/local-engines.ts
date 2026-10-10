// What the speech engines on this machine share (08): what the runtime does for them (SpeechHost:
// their programs, model files, readings kept), the supervisor of one run on a local port, a model or
// voice looked up by id, and their downloads (progress, failure, cancel).
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
export interface LocalEngine<Files> {
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
   *  kept. */
  kept(
    key: string,
    produce: () => Promise<Uint8Array<ArrayBuffer>>,
  ): Promise<Uint8Array<ArrayBuffer>>;
}

/** A reading kept when there is a cache, else made each time. */
export const keptIn =
  (cache: ReadingCache | undefined) =>
  (key: string, produce: () => Promise<Uint8Array<ArrayBuffer>>) =>
    cache ? cache.kept(key, produce) : produce();

/** What is offered with this id (a model, a voice); 404 when nothing is. */
export function offered<T extends { id: string }>(list: readonly T[], id: string): T {
  const found = list.find((m) => m.id === id);
  if (!found) throw new ServiceError("no_such_model", 404);
  return found;
}

/** An engine of the host run by the sidecar supervisor (06): one process for a setup (a model);
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

interface Download {
  /** Bytes so far. */
  done: number;
  /** All it fetches, when that is more than the model's own size (a model with its codec). */
  total?: number;
  controller: AbortController;
  error?: string;
}

/** Downloads of models or voices by id: one at a time each; a finished one is forgotten, a failed one
 *  kept with its error ("cancelled" when stopped) until it is started again or removed. */
export function createModelDownloads() {
  const downloads = new Map<string, Download>();
  const going = (id: string) => {
    const d = downloads.get(id);
    return d && !d.error ? d : undefined;
  };
  return {
    /** Whether a download of `id` is under way. */
    going: (id: string) => !!going(id),
    /** Starts `job` for `id` unless one is under way; it tells the bytes so far through `progress`. */
    start(
      id: string,
      job: (progress: (bytes: number) => void, signal: AbortSignal) => Promise<void>,
      total?: number,
    ) {
      if (going(id)) return;
      const entry: Download = { done: 0, total, controller: new AbortController() };
      downloads.set(id, entry);
      const { signal } = entry.controller;
      job((n) => (entry.done = n), signal)
        .then(() => {
          if (downloads.get(id) === entry) downloads.delete(id);
        })
        .catch((error: unknown) => {
          entry.error = signal.aborted ? "cancelled" : String(error).slice(0, 200);
        });
    },
    /** Stops a download of `id` and forgets it. */
    cancel(id: string) {
      downloads.get(id)?.controller.abort();
      downloads.delete(id);
    },
    /** What the state shows of `id`: the bytes so far while it goes, or why it failed. */
    of(id: string): { downloaded?: number; error?: string } {
      const d = downloads.get(id);
      if (!d) return {};
      return d.error ? { error: d.error } : { downloaded: d.done };
    },
    /** All a download under way fetches, when it was given. */
    total: (id: string) => going(id)?.total,
  };
}

/** Waits for `promise`, or rejects once `signal` aborts (what it waits for goes on). */
export const untilAborted = <T>(promise: Promise<T>, signal: AbortSignal) =>
  new Promise<T>((resolve, reject) => {
    promise.then(resolve, reject);
    signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
  });
