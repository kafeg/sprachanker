// Recognition on the phone as the server's speech service knows it: a SpeechHost whose whisper-server
// is Whisper in the app's process (the native side) — "started" by loading the model, reached at a
// local address this module answers (`/health`, `/inference`) instead of the network. The models
// are q8_0 on Android (docs/decisions.md): the phone's stands in for the file the service names.
import type { SpeechHost } from "@sprachanker/server/portable";
import type { Files } from "./files.ts";
import { native } from "./native.ts";

/** The address the service is given for "the engine": answered here, never on the network. */
const ENGINE = "127.0.0.1:1";
/** As many threads as a phone's big cores (docs/decisions.md). */
const THREADS = 4;
/** The service's model files → the phone's (q8_0). */
const PHONE_MODEL: Record<string, string> = {
  "ggml-small-q5_1.bin": "ggml-small-q8_0.bin",
};

export function phoneSpeech(files: Files) {
  let loading: Promise<unknown> = Promise.reject(new Error("no model loaded"));
  loading.catch(() => {});

  const host: SpeechHost = {
    freePort: async () => 1,
    models: {
      path(file) {
        const phone = PHONE_MODEL[file];
        return phone && files.has(`models/${phone}`) ? files.abs(`models/${phone}`) : undefined;
      },
      download: () => Promise.reject(new Error("models are put on the phone by the app's setup")),
      remove() {},
    },
    whisper: {
      binary: () => "in-app",
      spawn(_binary, { model }) {
        loading = native.loadModel(model);
        loading.catch((error: unknown) => console.error(`Whisper: ${error}`));
        return { exited: new Promise<number>(() => {}), kill() {} };
      },
    },
  };

  /** The engine's answers; anything else goes to `net`. */
  const fetchVia = (net: typeof fetch): typeof fetch =>
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.host !== ENGINE) return net(request);
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
    }) as typeof fetch;

  return { host, fetchVia };
}

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
