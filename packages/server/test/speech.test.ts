import { expect, test } from "bun:test";
import { CLIENT_HEADERS } from "@sprachanker/schema";
import type { SpeechHost } from "../src/services/local-engines.ts";
import { setup } from "./setup.ts";

/** A machine with the engine built and models kept in memory; the engine answers through `fetch`. */
function machine(answer = " Ich heiße Nico.\n") {
  const files = new Set<string>();
  const spawned: string[][] = [];
  let kills = 0;
  let healthy = false;
  const host: SpeechHost = {
    freePort: async () => 9911,
    whisper: {
      binary: () => "/opt/whisper-server",
      spawn(binary, { model }, port) {
        spawned.push([binary, model, String(port)]);
        setTimeout(() => (healthy = true), 30);
        return { exited: new Promise(() => {}), kill: () => void kills++ };
      },
    },
    models: {
      path: (file) => (files.has(file) ? `/models/${file}` : undefined),
      async download(url, model, onProgress) {
        expect(url).toContain("/resolve/");
        onProgress(model.bytes / 2);
        files.add(model.file);
      },
      remove: (file) => void files.delete(file),
    },
  };
  const sent: FormData[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    if (url === "http://127.0.0.1:9911/health")
      return new Response(healthy ? "ok" : "loading", { status: healthy ? 200 : 503 });
    if (url === "http://127.0.0.1:9911/inference") {
      sent.push(init?.body as FormData);
      return Response.json({ text: answer });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  return { host, fetch, spawned, sent, kills: () => kills };
}

test("speech: models downloaded, the engine started on demand with the chosen model, a WAV transcribed in its language", async () => {
  const m = machine();
  const { app, cookie, getJson, sendJson, send } = await setup({ fetch: m.fetch, speech: m.host });
  const transcribe = (lang: string) =>
    app.request(`/api/speech/transcribe?lang=${lang}`, {
      method: "POST",
      headers: { cookie, "content-type": "audio/wav", ...CLIENT_HEADERS },
      body: new Uint8Array(44),
    });

  // No model yet: recognition is off and transcribing is refused.
  const before = await getJson("/api/speech");
  expect(before).toMatchObject({ engine: true, recognition: false, model: null });
  expect(before.models.map((x: { id: string }) => x.id)).toEqual([
    "large-v3-turbo-q5_0",
    "small-q5_1",
  ]);
  expect((await transcribe("de")).status).toBe(409);

  await sendJson("POST", "/api/speech/models/small-q5_1", {});
  const after = await getJson("/api/speech");
  expect(after).toMatchObject({ recognition: true, model: "small-q5_1" });
  expect(after.models[1]).toMatchObject({ installed: true });

  const heard = await transcribe("de");
  expect(heard.status).toBe(200);
  expect(await heard.json()).toMatchObject({ text: "Ich heiße Nico." });
  expect(m.spawned).toEqual([["/opt/whisper-server", "/models/ggml-small-q5_1.bin", "9911"]]);
  expect(m.sent[0]?.get("language")).toBe("de");
  // Warm and used again: one engine.
  await sendJson("POST", "/api/speech/warm", {});
  await transcribe("de");
  expect(m.spawned).toHaveLength(1);

  // The profile turns recognition off: refused, though the engine is there.
  await send("PUT", "/api/settings", { key: "speech.recognition", value: false });
  expect((await getJson("/api/speech")).recognition).toBe(false);
  expect((await transcribe("de")).status).toBe(409);
  await send("PUT", "/api/settings", { key: "speech.recognition", value: true });

  // The model removed: the engine running it stops.
  await send("DELETE", "/api/speech/models/small-q5_1", {});
  expect(m.kills()).toBe(1);
  expect((await getJson("/api/speech")).recognition).toBe(false);
  expect((await send("POST", "/api/speech/models/nope", {})).status).toBe(404);
});

test("speech: without the engine built, nothing to recognise with", async () => {
  const m = machine();
  const { getJson } = await setup({
    fetch: m.fetch,
    speech: { ...m.host, whisper: undefined },
  });
  expect(await getJson("/api/speech")).toMatchObject({ engine: false, recognition: false });
});

/** A 16 kHz 16-bit mono WAV of stretches: silence (amplitude 0) or a 220 Hz tone. */
function wav(...parts: Array<{ ms: number; amplitude: number }>) {
  const samples = parts.flatMap(({ ms, amplitude }) =>
    Array.from({ length: (ms * 16_000) / 1000 }, (_, i) =>
      Math.round(amplitude * 32767 * Math.sin((2 * Math.PI * 220 * i) / 16_000)),
    ),
  );
  const out = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  out.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 1, true);
  out.setUint32(24, 16_000, true);
  out.setUint32(28, 32_000, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  text(36, "data");
  out.setUint32(40, samples.length * 2, true);
  samples.forEach((v, i) => {
    out.setInt16(44 + i * 2, v, true);
  });
  return new Uint8Array(out.buffer);
}

test("speech: a silent take is nothing heard, the engine not asked; a near-silent one heard as a phrase made up of silence is nothing too", async () => {
  const hear = async (answer: string, body: Uint8Array) => {
    const m = machine(answer);
    const { app, cookie, sendJson } = await setup({ fetch: m.fetch, speech: m.host });
    await sendJson("POST", "/api/speech/models/small-q5_1", {});
    const res = await app.request("/api/speech/transcribe?lang=de", {
      method: "POST",
      headers: { cookie, "content-type": "audio/wav", ...CLIENT_HEADERS },
      body,
    });
    return { text: ((await res.json()) as { text: string }).text, asked: m.sent.length };
  };
  // Digital silence, and a faint hiss: the engine is never asked.
  const silence = wav({ ms: 4000, amplitude: 0 });
  expect(await hear(" Vielen Dank.", silence)).toEqual({ text: "", asked: 0 });
  expect(await hear(" Amen.", wav({ ms: 4000, amplitude: 0.002 }))).toEqual({ text: "", asked: 0 });
  // A click in the quiet heard as Whisper's "thank you" or its subtitle credits: dropped.
  const quiet = { ms: 2000, amplitude: 0 };
  const click = wav(quiet, { ms: 160, amplitude: 0.5 }, quiet);
  expect(await hear(" Vielen Dank.", click)).toEqual({ text: "", asked: 1 });
  expect(await hear(" Untertitel im Auftrag des ZDF, 2017", click)).toEqual({ text: "", asked: 1 });
  // Anything else heard in it is kept; so is "Vielen Dank." said aloud, and a phrase of another
  // language's list.
  expect((await hear(" Ja.", click)).text).toBe("Ja.");
  expect((await hear(" Thank you.", click)).text).toBe("Thank you.");
  expect((await hear(" Vielen Dank.", wav({ ms: 1200, amplitude: 0.3 }))).text).toBe(
    "Vielen Dank.",
  );
});
