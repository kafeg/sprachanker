// The speech engines on paper, for the tests that read aloud: Piper's host and a machine with
// Qwen3-TTS.
import { expect } from "bun:test";
import type { ReadingCache, SpeechHost } from "../src/services/local-engines.ts";
import type { PiperHost, PiperVoice } from "../src/services/read-aloud.ts";

/** A Piper host on paper: voices installed by id, what it was asked to say (under which key it is
 *  kept), a WAV per text — or what `say` makes of it (a reading held back, one failing). */
export function piper(
  installed: string[],
  built = true,
  say: (text: string) => Promise<Uint8Array<ArrayBuffer>> = async () =>
    new Uint8Array([82, 73, 70, 70]),
) {
  const said: Array<{ key: string; id: string; text: string; lengthScale: number }> = [];
  let key = "";
  const readings: ReadingCache = {
    kept(k, produce, signal = new AbortController().signal) {
      key = k;
      return produce(signal);
    },
  };
  const downloaded: string[] = [];
  const host: PiperHost = {
    binary: () => (built ? "/bin/sherpa" : undefined),
    voiceDir: (id) => (installed.includes(id) ? `/voices/${id}` : undefined),
    async download(_url, voice: PiperVoice) {
      downloaded.push(voice.id);
      installed.push(voice.id);
    },
    remove(id) {
      installed.splice(installed.indexOf(id), 1);
    },
    async run(run) {
      said.push({ key, id: run.id, text: run.text, lengthScale: run.lengthScale });
      return say(run.text);
    },
  };
  return { host, readings, said, downloaded };
}

/** A machine with Qwen3-TTS on paper: model files "there" by name, the engine a local HTTP server
 *  that answers its health check, keeps the voices registered with it (`registered`, by the talker
 *  that took them) and says what it is asked as bytes — or what `say` makes of it (a WAV); the voices
 *  for words kept in memory (`kept`); `exitAll` ends the engine's processes. */
export function qwen(
  files: string[] = [],
  say: (text: string) => Uint8Array = (text) => new TextEncoder().encode(text),
) {
  const asked: Array<Record<string, unknown>> = [];
  const registered: Array<Record<string, unknown> & { talker: string }> = [];
  const kept = new Map<string, { wav: Uint8Array<ArrayBuffer>; about: unknown }>();
  const talkers: string[] = [];
  /** What a voice registered is answered with (a test sets 400: the engine refuses it). */
  const voices = { status: 200 };
  /** The processes running: each ended by its function (as one that exits). */
  const running: Array<() => void> = [];
  let spawned = 0;
  const host: SpeechHost = {
    qwen: {
      binary: () => "/bin/tts-server",
      spawn(_binary, { talker, codec }, port) {
        spawned++;
        talkers.push(talker);
        expect([talker, codec].every((f) => f.startsWith("/models/"))).toBe(true);
        const server = Bun.serve({
          port,
          async fetch(req) {
            const path = new URL(req.url).pathname;
            if (path === "/health") return Response.json({ status: "ok" });
            const body = (await req.json()) as Record<string, unknown>;
            if (path === "/v1/audio/voices") {
              registered.push({ ...body, talker });
              return Response.json({ ok: voices.status === 200 }, { status: voices.status });
            }
            asked.push({ ...body, talker });
            return new Response(say(String(body.input)));
          },
        });
        let exit = (_code: number) => {};
        const exited = new Promise<number>((resolve) => {
          exit = resolve;
        });
        const end = () => {
          void server.stop(true);
          exit(0);
        };
        running.push(end);
        return { exited, kill: end };
      },
    },
    freePort: async () => {
      const probe = Bun.serve({ port: 0, fetch: () => new Response() });
      const port = probe.port as number;
      probe.stop(true);
      return port;
    },
    models: {
      path: (file) => (files.includes(file) ? `/models/${file}` : undefined),
      async download(_url, model) {
        files.push(model.file);
      },
      remove(file) {
        files.splice(files.indexOf(file), 1);
      },
    },
    wordVoices: {
      get: (lang) => kept.get(lang),
      put: (lang, { wav, about }) => void kept.set(lang, { wav: new Uint8Array(wav), about }),
    },
  };
  /** Every engine process exits (a crash, or its idle stop). */
  const exitAll = () => {
    for (const end of running.splice(0)) end();
  };
  return { host, asked, registered, kept, files, talkers, exitAll, voices, spawned: () => spawned };
}

/** What Whisper hears of the fixture's two answer recordings. */
export const SAID = {
  "guten-abend-danke.mp3": "Guten Abend! Danke, gut. Und dir?",
  "hallo-guten-tag.mp3": "Hallo! Guten Tag!",
};

/** A machine with whisper-server: what it hears of a fixture recording is said by its name (`said`);
 *  one named in `failing` it fails to hear (every one while `state.broken`). `installed`: whether its
 *  models are there (false: none until one is downloaded). */
export function whisper(
  said: Record<string, string>,
  failing: string[] = [],
  options: { installed?: boolean } = {},
) {
  const heard: string[] = [];
  const state = { installed: options.installed ?? true, broken: false };
  const speech: SpeechHost = {
    freePort: async () => 9913,
    whisper: {
      binary: () => "/opt/whisper-server",
      spawn: () => ({ exited: new Promise(() => {}), kill() {} }),
    },
    models: {
      path: (file) => (state.installed ? `/models/${file}` : undefined),
      async download() {
        state.installed = true;
      },
      remove() {},
    },
  };
  const fetch = (async (url: string, init: RequestInit) => {
    if (url === "http://127.0.0.1:9913/health") return new Response("ok");
    if (url === "http://127.0.0.1:9913/inference") {
      const file = (init.body as FormData).get("file") as Blob;
      const name = (await file.text()).replace("sprachanker-fixture:", "");
      heard.push(name);
      if (state.broken || failing.includes(name)) return new Response("no", { status: 500 });
      return Response.json({ text: ` ${said[name] ?? ""}\n` });
    }
    return new Response("no", { status: 500 });
  }) as unknown as typeof globalThis.fetch;
  return { speech, fetch, heard, state };
}
