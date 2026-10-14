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
 *  that answers its health check and says what it is asked as bytes — or what `say` makes of it (a
 *  WAV). */
export function qwen(
  files: string[] = [],
  say: (text: string) => Uint8Array = (text) => new TextEncoder().encode(text),
) {
  const asked: Array<Record<string, unknown>> = [];
  const talkers: string[] = [];
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
            if (new URL(req.url).pathname === "/health") return Response.json({ status: "ok" });
            const body = (await req.json()) as Record<string, unknown>;
            asked.push(body);
            return new Response(say(String(body.input)));
          },
        });
        return { exited: new Promise<number>(() => {}), kill: () => void server.stop(true) };
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
  };
  return { host, asked, files, talkers, spawned: () => spawned };
}
