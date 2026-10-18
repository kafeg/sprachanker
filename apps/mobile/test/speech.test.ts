// Reading aloud on the phone as the server's speech services see it, the native side played here: the
// device's voices as the page's speechSynthesis (voices.ts over Voices.kt's answers), Qwen3-TTS's
// program started on a port and asked through the native side (speech.ts), Piper's voices downloaded,
// unpacked and put in place over the phone's files, a text read by its program (piper.ts).
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { memoryFs } from "@sprachanker/course-kit/memory-fs";

(globalThis as { sprachankerFiles?: string }).sprachankerFiles = "http://files.test";
const { installVoices, voiceLabel } = await import("../src/voices.ts");
const { phoneSpeech } = await import("../src/speech.ts");
const { phonePiper } = await import("../src/piper.ts");

/** The native side's answers to the page (`sprachankerNative.done`). */
const done = (id: number, answer: unknown) =>
  (
    globalThis as unknown as { sprachankerNative: { done(i: number, a: unknown): void } }
  ).sprachankerNative.done(id, answer);

test("the device's voices: Android's, named without their language, the default first; an utterance said with its voice and speed, its start and end told; cancel ends it", () => {
  const asked: Array<{ id: number; text: string; lang: string; voice: string; rate: number }> = [];
  let voicesId = 0;
  let stopped = 0;
  (globalThis as { sprachankerVoices?: unknown }).sprachankerVoices = {
    voices: (id: number) => {
      voicesId = id;
    },
    speak: (id: number, text: string, lang: string, voice: string, rate: number) =>
      asked.push({ id, text, lang, voice, rate }),
    stop: () => void stopped++,
  };
  installVoices();
  const synth = speechSynthesis;
  let changed = 0;
  synth.addEventListener("voiceschanged", () => changed++);
  expect(synth.getVoices()).toEqual([]);
  done(voicesId, [
    { name: "de-de-x-deb-local", lang: "de-DE", quality: 300, default: false },
    { name: "de-de-x-nfh-local", lang: "de-DE", quality: 400, default: false },
    { name: "en-us-x-tpf-local", lang: "en-US", quality: 400, default: true },
  ]);
  expect(changed).toBe(1);
  expect(synth.getVoices().map((v) => [v.name, v.voiceURI])).toEqual([
    ["tpf · en-US", "en-us-x-tpf-local"],
    ["nfh · de-DE", "de-de-x-nfh-local"],
    ["deb · de-DE", "de-de-x-deb-local"],
  ]);
  expect(voiceLabel("de-DE-language", "de-DE")).toBe("de-DE");

  const told: string[] = [];
  const u = new SpeechSynthesisUtterance("Guten Tag");
  u.voice = synth.getVoices()[1] ?? null;
  u.rate = 0.8;
  u.onstart = () => told.push("start");
  u.onend = () => told.push("end");
  synth.speak(u);
  expect(asked).toEqual([
    {
      id: asked[0]?.id ?? 0,
      text: "Guten Tag",
      lang: "de-DE",
      voice: "de-de-x-nfh-local",
      rate: 0.8,
    },
  ]);
  expect(synth.speaking).toBe(true);
  done(asked[0]?.id ?? 0, "start");
  done(asked[0]?.id ?? 0, "end");
  expect(told).toEqual(["start", "end"]);
  expect(synth.speaking).toBe(false);

  // Without a voice: the language's; cancelled, it ends at once, and what the native side tells
  // after is not told again.
  const w = new SpeechSynthesisUtterance("Hallo");
  w.lang = "de";
  w.onend = () => told.push("w end");
  synth.speak(w);
  expect(asked[1]).toMatchObject({ lang: "de", voice: "" });
  synth.cancel();
  done(asked[1]?.id ?? 0, "end");
  expect(told).toEqual(["start", "end", "w end"]);
  expect(stopped).toBe(1);
});

/** The native side's programs on paper: what was started, its requests answered. */
function programs(answer: (path: string, body: string | null) => [number, Uint8Array]) {
  const started: Array<{ engine: string; args: string[] }> = [];
  const asked: Array<{ port: number; method: string; path: string; body: string | null }> = [];
  const ends = new Map<number, (r: { code: number; log: string }) => void>();
  const killed: number[] = [];
  /** The phone kept awake (true) or let go, in turn. */
  const awake: boolean[] = [];
  return {
    started,
    asked,
    killed,
    awake,
    end: (pid: number, code: number, log = "") => ends.get(pid)?.({ code, log }),
    programs: {
      spawn: async (engine: "piper" | "qwen", args: string[]) => {
        started.push({ engine, args });
        return started.length;
      },
      wait: (pid: number) => new Promise<{ code: number; log: string }>((r) => ends.set(pid, r)),
      kill: async (pid: number) => void killed.push(pid),
      freePort: async () => 4242,
      awake: (on: boolean) => void awake.push(on),
      http: async (port: number, method: string, path: string, body: string | null) => {
        asked.push({ port, method, path, body });
        const [status, bytes] = answer(path, body);
        const out = new Uint8Array(bytes.length + 2);
        out.set([status >> 8, status & 255]);
        out.set(bytes, 2);
        return out.buffer;
      },
    },
  };
}

test("Qwen3-TTS on the phone: its program started with the model on a free port, its requests made by the native side; Whisper's port answered here, other hosts by the network", async () => {
  const p = programs((path) =>
    path === "/health" ? [200, new TextEncoder().encode("ok")] : [200, new Uint8Array([82, 73])],
  );
  const models = { path: () => undefined, download: async () => {}, remove() {} };
  const { host, fetchVia } = phoneSpeech(models, {
    whisper: true,
    engines: ["qwen", "piper"],
    android: true,
    programs: p.programs,
  });
  expect(host).toMatchObject({ phone: true, platform: "android" });
  expect(await host.freePort()).toBe(4242);
  const proc = host.qwen?.spawn(
    "in-app",
    { talker: "/d/models/t.gguf", codec: "/d/models/c.gguf" },
    4242,
  );
  await Bun.sleep(1);
  expect(p.started).toEqual([
    {
      engine: "qwen",
      args: [
        "--model",
        "/d/models/t.gguf",
        "--codec",
        "/d/models/c.gguf",
        "--host",
        "127.0.0.1",
        "--port",
        "4242",
      ],
    },
  ]);
  let net = 0;
  const fetch = fetchVia((async () => {
    net++;
    return new Response("net");
  }) as unknown as typeof globalThis.fetch);
  expect((await fetch("http://127.0.0.1:4242/health")).status).toBe(200);
  const said = await fetch("http://127.0.0.1:4242/v1/audio/speech", {
    method: "POST",
    body: JSON.stringify({ input: "Hallo" }),
  });
  expect([...new Uint8Array(await said.arrayBuffer())]).toEqual([82, 73]);
  expect(p.asked.map((a) => [a.method, a.path, a.body])).toEqual([
    ["GET", "/health", null],
    ["POST", "/v1/audio/speech", '{"input":"Hallo"}'],
  ]);
  // A request given up is not waited for.
  const gone = new AbortController();
  gone.abort();
  await expect(fetch("http://127.0.0.1:4242/health", { signal: gone.signal })).rejects.toThrow();
  expect((await fetch("https://example.test/x")).status).toBe(200);
  // Another program on this phone (an LLM's server): the network's, as it is.
  await fetch("http://127.0.0.1:1234/v1/models?x=1");
  expect(net).toBe(2);
  // The program ends: the supervisor is told, with what it said.
  p.end(1, 3, "out of memory");
  expect(await proc?.exited).toBe(3);
  expect(proc?.stderr?.()).toBe("out of memory");
  proc?.kill();
  await Bun.sleep(1);
  expect(p.killed).toEqual([1]);
});

test("Piper on the phone: a voice downloaded and checked, unpacked, put in place whole; a text read by its program, its reading taken back", async () => {
  const fs = memoryFs();
  const root = "/data";
  fs.writeFile(`${root}/models/voices/old.part/x`, "left by a stopped app");
  const archive = new TextEncoder().encode("archive");
  const sha256 = createHash("sha256").update(archive).digest("hex");
  const net = (async () => new Response(archive)) as unknown as typeof fetch;
  const p = programs(() => [200, new Uint8Array()]);
  const unpacked: string[] = [];
  const outputs = new Map<string, Uint8Array>();
  const piper = phonePiper(fs, root, net, {
    built: true,
    programs: p.programs,
    files: {
      async untar(from, into) {
        unpacked.push(from);
        fs.writeFile(`${into}/vits-piper-de_DE-x-medium/de_DE-x-medium.onnx`, "model");
        fs.writeFile(`${into}/vits-piper-de_DE-x-medium/tokens.txt`, "tokens");
      },
      outputs: async () => "/cache/engines",
      output: async (name) => {
        const wav = outputs.get(name);
        if (!wav) throw new Error("none");
        return wav.buffer as ArrayBuffer;
      },
    },
  });
  expect(fs.list(`${root}/models/voices`)).toEqual([]);
  expect(piper.binary()).toBe("in-app");
  expect(piper.voiceDir("de_DE-x-medium")).toBeUndefined();
  const voice = {
    id: "de_DE-x-medium",
    lang: "de",
    region: "DE",
    name: "x",
    quality: "medium",
    bytes: archive.length,
    sha256,
  };
  await piper.download(
    "https://voices.test/x.tar.bz2",
    voice,
    () => {},
    new AbortController().signal,
  );
  expect(unpacked).toEqual([`${root}/models/voices/de_DE-x-medium.tar.bz2.part`]);
  expect(fs.list(`${root}/models/voices`)).toEqual(["de_DE-x-medium"]);
  const dir = piper.voiceDir("de_DE-x-medium");
  expect(dir).toBe(`${root}/models/voices/de_DE-x-medium`);

  const reading = piper.run({
    binary: "in-app",
    dir: dir ?? "",
    id: voice.id,
    text: "Hallo",
    lengthScale: 1,
  });
  await Bun.sleep(1);
  const args = p.started[0]?.args ?? [];
  expect(p.started[0]?.engine).toBe("piper");
  expect(args).toContain(`--vits-model=${dir}/de_DE-x-medium.onnx`);
  expect(args.at(-1)).toBe("Hallo");
  const out = args.find((a) => a.startsWith("--output-filename=/cache/engines/")) ?? "";
  outputs.set(out.slice(out.lastIndexOf("/") + 1), new Uint8Array([82, 73, 70, 70]));
  p.end(1, 0);
  expect([...(await reading)]).toEqual([82, 73, 70, 70]);

  // Awake while the program read, let go at its end.
  expect(p.awake).toEqual([true, false]);

  // A program that fails: no reading.
  const failed = piper.run({
    binary: "in-app",
    dir: dir ?? "",
    id: voice.id,
    text: "x",
    lengthScale: 1,
  });
  await Bun.sleep(1);
  p.end(2, 1, "no espeak data");
  await expect(failed).rejects.toThrow(/no espeak data/);
  expect(p.awake).toEqual([true, false, true, false]);

  piper.remove(voice.id);
  expect(piper.voiceDir(voice.id)).toBeUndefined();
});

test("the phone kept awake while an engine reads: each request to Qwen3-TTS's program till it answers — one the page gave up on too —, let go after", async () => {
  let answer: (() => void) | undefined;
  const p = programs(() => [200, new Uint8Array([1])]);
  const http = p.programs.http;
  p.programs.http = async (...args) => {
    await new Promise<void>((r) => {
      answer = r;
    });
    return http(...args);
  };
  const models = { path: () => undefined, download: async () => {}, remove() {} };
  const { host, fetchVia, idle } = phoneSpeech(models, {
    whisper: false,
    engines: ["qwen"],
    android: true,
    programs: p.programs,
  });
  host.qwen?.spawn("in-app", { talker: "t", codec: "c" }, 4242);
  const fetch = fetchVia((async () => new Response("net")) as unknown as typeof globalThis.fetch);
  const said = fetch("http://127.0.0.1:4242/v1/audio/speech", { method: "POST", body: "{}" });
  await Bun.sleep(1);
  expect(p.awake).toEqual([true]);
  expect(idle()).toBe(false);
  answer?.();
  expect((await said).status).toBe(200);
  expect(p.awake).toEqual([true, false]);
  expect(idle()).toBe(true);

  // Given up by the page: the engine still reads, the phone stays awake till it answers.
  const gone = new AbortController();
  const left = fetch("http://127.0.0.1:4242/v1/audio/speech", {
    method: "POST",
    body: "{}",
    signal: gone.signal,
  });
  await Bun.sleep(1);
  gone.abort();
  await expect(left).rejects.toThrow();
  expect(p.awake).toEqual([true, false, true]);
  answer?.();
  await Bun.sleep(1);
  expect(p.awake).toEqual([true, false, true, false]);
  // Another host's request (an LLM): not a reading.
  await fetch("https://example.test/x");
  expect(p.awake).toHaveLength(4);
});
