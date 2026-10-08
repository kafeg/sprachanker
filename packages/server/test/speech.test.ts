import { expect, test } from "bun:test";
import { CLIENT_HEADERS } from "@sprachanker/schema";
import type { SpeechHost } from "../src/services/speech.ts";
import { setup } from "./setup.ts";

/** A machine with the engine built and models kept in memory; the engine answers through `fetch`. */
function machine() {
  const files = new Set<string>();
  const spawned: string[][] = [];
  let kills = 0;
  let healthy = false;
  const host: SpeechHost = {
    whisperBinary: () => "/opt/whisper-server",
    freePort: async () => 9911,
    spawnWhisper(binary, model, port) {
      spawned.push([binary, model, String(port)]);
      setTimeout(() => (healthy = true), 30);
      return { exited: new Promise(() => {}), kill: () => void kills++ };
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
      return Response.json({ text: " Ich heiße Nico.\n" });
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
    speech: { ...m.host, whisperBinary: () => undefined },
  });
  expect(await getJson("/api/speech")).toMatchObject({ engine: false, recognition: false });
});
