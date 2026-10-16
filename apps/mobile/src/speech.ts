// The phone's speech engines as the server's speech services know them (SpeechHost): Whisper in the
// app's process (the native side) "started" by loading the model and reached at a local address this
// module answers (`/health`, `/inference`) instead of the network; Qwen3-TTS's tts-server a program the
// app carries, run as on a computer — a process listening on a 127.0.0.1 port, its requests made by
// the native side (the page's own cannot reach it). Its models are the server's own store over the
// phone's files (downloaded in the app, the service's list: q8_0 on Android, docs/decisions.md); a
// phone's defaults are the small models, every one offered.
import type { SpeechHost } from "@sprachanker/server/portable";
import { native } from "./native.ts";

/** As many threads as a phone's big cores (docs/decisions.md). */
const THREADS = 4;
/** How long an engine's answer may take: a health check, a reading (the server's own limit is less). */
const HEALTH_MS = 5_000;
const ANSWER_MS = 180_000;

/** What the native side does for the engines it runs as programs (src-tauri/src/engines.rs). */
export interface EnginePrograms {
  spawn(engine: "piper" | "qwen", args: string[]): Promise<number>;
  wait(pid: number): Promise<{ code: number; log: string }>;
  kill(pid: number): Promise<void>;
  freePort(): Promise<number>;
  /** Two bytes of status, then the body. */
  http(
    port: number,
    method: string,
    path: string,
    body: string | null,
    timeout: number,
  ): Promise<ArrayBuffer>;
}

export const nativePrograms: EnginePrograms = {
  spawn: native.engineSpawn,
  wait: native.engineWait,
  kill: native.engineKill,
  freePort: native.freePort,
  http: native.localHttp,
};

/** A program run as an engine of the sidecar supervisor: its end, stopped, what it said. */
export function programProcess(programs: EnginePrograms, engine: "piper" | "qwen", args: string[]) {
  let said = "";
  const pid = programs.spawn(engine, args);
  const exited = pid.then(
    (p) =>
      programs.wait(p).then(({ code, log }) => {
        said = log;
        return code;
      }),
    (error: unknown) => {
      said = String(error);
      return 1;
    },
  );
  return {
    exited,
    kill: () => void pid.then((p) => programs.kill(p)).catch(() => {}),
    stderr: () => said,
  };
}

export function phoneSpeech(
  models: SpeechHost["models"],
  options: {
    /** Whisper is built into the app. */
    whisper: boolean;
    /** The engines the app carries as programs. */
    engines: string[];
    android: boolean;
    wordVoices?: SpeechHost["wordVoices"];
    programs?: EnginePrograms;
  },
) {
  const programs = options.programs ?? nativePrograms;
  let loading: Promise<unknown> = Promise.reject(new Error("no model loaded"));
  loading.catch(() => {});
  /** Requests to the engines under way (none: they may be stopped). */
  let asking = 0;
  /** The port Whisper was "started" on: answered here, never on the network. */
  let whisperPort = "";
  /** The ports the engines run as programs were started on: asked through the native side. Any other
   *  address — 127.0.0.1 too (an LLM on this phone) — goes to the network as it is. */
  const programPorts = new Set<string>();

  const host: SpeechHost = {
    ...(options.android && { platform: "android" as const }),
    phone: true,
    freePort: () => programs.freePort(),
    models,
    ...(options.wordVoices && { wordVoices: options.wordVoices }),
    whisper: {
      binary: () => (options.whisper ? "in-app" : undefined),
      spawn(_binary, { model }, port) {
        whisperPort = String(port);
        loading = native.loadModel(model);
        // A model that does not load ends "the process" at once (the supervisor stops waiting).
        const exited = loading.then(
          () => new Promise<number>(() => {}),
          (error: unknown) => {
            console.error(`Whisper: ${error}`);
            return 1;
          },
        );
        return { exited, kill() {} };
      },
    },
    ...(options.engines.includes("qwen") && {
      qwen: {
        binary: () => "in-app",
        spawn: (_binary, { talker, codec }, port) => {
          programPorts.add(String(port));
          const proc = programProcess(programs, "qwen", [
            "--model",
            talker,
            "--codec",
            codec,
            "--host",
            "127.0.0.1",
            "--port",
            String(port),
          ]);
          void proc.exited.then(() => programPorts.delete(String(port)));
          return proc;
        },
      },
    }),
  };

  /** The engines' answers; anything else goes to `net`. */
  const fetchVia = (net: typeof fetch): typeof fetch =>
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const local = url.hostname === "127.0.0.1";
      if (local && url.port === whisperPort) return whisper(request, url);
      if (!local || !programPorts.has(url.port)) return net(request);
      const body = request.method === "GET" ? null : await request.text();
      const timeout = url.pathname === "/health" ? HEALTH_MS : ANSWER_MS;
      const signal = init?.signal ?? request.signal;
      signal?.throwIfAborted();
      const path = url.pathname + url.search;
      const asked = programs.http(Number(url.port), request.method, path, body, timeout);
      asking++;
      const answer = await (signal ? Promise.race([asked, aborted(signal)]) : asked).finally(
        () => asking--,
      );
      const bytes = new Uint8Array(answer);
      const status = (bytes[0] ?? 0) * 256 + (bytes[1] ?? 0);
      return new Response(status === 204 ? null : bytes.slice(2), { status });
    }) as typeof fetch;

  async function whisper(request: Request, url: URL) {
    if (url.pathname === "/health") {
      await loading;
      return Response.json({ status: "ok" });
    }
    if (url.pathname === "/inference") {
      const form = await request.formData();
      const audio = form.get("file") as Blob;
      const lang = String(form.get("language") ?? "de");
      const samples = await samples16k(await audio.arrayBuffer());
      const heard = await native.transcribe(samples, lang, THREADS);
      return Response.json({ text: heard.text, segments: [] });
    }
    return new Response("not found", { status: 404 });
  }

  return { host, fetchVia, idle: () => asking === 0 };
}

/** Rejects when `signal` aborts (a request given up: its answer no longer awaited). */
const aborted = (signal: AbortSignal) =>
  new Promise<never>((_, reject) => {
    const fail = () => reject(signal.reason ?? new DOMException("aborted", "AbortError"));
    if (signal.aborted) fail();
    else signal.addEventListener("abort", fail, { once: true });
  });

/** 16 kHz mono samples of a recording: a 16-bit PCM WAV read as it is (what the app records),
 *  anything else decoded and resampled by the WebView. */
async function samples16k(buf: ArrayBuffer): Promise<Float32Array> {
  const v = new DataView(buf);
  const tag = (at: number) =>
    String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));
  if (buf.byteLength > 44 && tag(0) === "RIFF" && tag(8) === "WAVE") {
    const channels = v.getUint16(22, true);
    const rate = v.getUint32(24, true);
    const bits = v.getUint16(34, true);
    for (let at = 12; at + 8 <= buf.byteLength; ) {
      const size = v.getUint32(at + 4, true);
      if (tag(at) === "data" && channels === 1 && rate === 16000 && bits === 16) {
        const out = new Float32Array(Math.floor(size / 2));
        for (let i = 0; i < out.length; i++) out[i] = v.getInt16(at + 8 + i * 2, true) / 32768;
        return out;
      }
      at += 8 + size + (size % 2);
    }
  }
  const ctx = new OfflineAudioContext(1, 16000, 16000);
  const decoded = await ctx.decodeAudioData(buf.slice(0));
  if (decoded.sampleRate === 16000) return decoded.getChannelData(0);
  const length = Math.ceil(decoded.duration * 16000);
  const resample = new OfflineAudioContext(1, length, 16000);
  const source = resample.createBufferSource();
  source.buffer = decoded;
  source.connect(resample.destination);
  source.start();
  return (await resample.startRendering()).getChannelData(0);
}
