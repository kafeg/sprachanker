import { expect, test } from "bun:test";
import { CLIENT_HEADERS } from "@sprachanker/schema";
import type { SpeechHost } from "../src/services/local-engines.ts";
import { setup } from "./setup.ts";

/** A machine with the engine built and models kept in memory; the engine answers through `fetch`
 *  (verbose_json: with a segment as sure as `logprob` when given; `reply` changes it). */
function machine(text = " Ich heiße Nico.\n", sure?: number) {
  let answer = text;
  let logprob = sure;
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
      return Response.json({
        text: answer,
        segments: logprob === undefined ? [] : [{ text: answer, avg_logprob: logprob }],
      });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  const reply = (text: string, sure?: number) => {
    answer = text;
    logprob = sure;
  };
  return { host, fetch, spawned, sent, kills: () => kills, reply };
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

test("speech: a silent take is nothing heard, the engine not asked; what Whisper makes of silence and noise is nothing too, a line said is kept", async () => {
  const m = machine();
  const { app, cookie, sendJson } = await setup({ fetch: m.fetch, speech: m.host });
  await sendJson("POST", "/api/speech/models/small-q5_1", {});
  /** What a take is heard as, the engine answering `answer`; `asked`: whether it was asked. */
  const hear = async (
    body: Uint8Array,
    answer: string,
    { logprob, expect: lines }: { logprob?: number; expect?: string[] } = {},
  ) => {
    m.reply(answer, logprob);
    const before = m.sent.length;
    const query = new URLSearchParams({ lang: "de", ...(lines && { expect: lines.join("\n") }) });
    const res = await app.request(`/api/speech/transcribe?${query}`, {
      method: "POST",
      headers: { cookie, "content-type": "audio/wav", ...CLIENT_HEADERS },
      body,
    });
    const heard = (await res.json()) as { text: string; silent?: boolean };
    return { text: heard.text, silent: !!heard.silent, asked: m.sent.length - before };
  };
  const nothing = (asked: number) => ({ text: "", silent: true, asked });
  // Digital silence, a faint hiss (-60 dBFS), a click of 20 ms: the engine is never asked.
  const quiet = { ms: 2000, amplitude: 0 };
  expect(await hear(wav({ ms: 4000, amplitude: 0 }), " Vielen Dank.")).toEqual(nothing(0));
  expect(await hear(wav({ ms: 4000, amplitude: 0.0014 }), " Amen.")).toEqual(nothing(0));
  expect(await hear(wav(quiet, { ms: 20, amplitude: 0.5 }, quiet), " Danke.")).toEqual(nothing(0));
  // A short word said quietly (-46 dBFS for 60 ms) is asked about, and kept.
  const word = wav(quiet, { ms: 60, amplitude: 0.007 }, quiet);
  expect(await hear(word, " Ich.")).toEqual({ text: "Ich.", silent: false, asked: 1 });

  // Near-silent (never above -36.5 dBFS, under 250 ms as loud as speech): Whisper's "thank you"
  // dropped — unless it is the line to say.
  const faint = wav(quiet, { ms: 200, amplitude: 0.018 }, quiet);
  expect(await hear(faint, " Danke.")).toEqual(nothing(1));
  expect((await hear(faint, " Danke.", { expect: ["Danke!", "Bitte!"] })).text).toBe("Danke.");
  // Said at a normal level, "Danke." and "Tschüss." are kept (Whisper sure of them).
  const spoken = wav(quiet, { ms: 400, amplitude: 0.1 }, quiet);
  expect((await hear(spoken, " Danke.", { logprob: -0.05 })).text).toBe("Danke.");
  expect((await hear(spoken, " Tschüss.")).text).toBe("Tschüss.");
  // Steady noise (pink, hum) heard as "Vielen Dank." dropped, and any word Whisper is unsure of in it;
  // a loud tap heard as "Vielen Dank." with Whisper unsure of it too.
  const hum = wav({ ms: 3000, amplitude: 0.05 });
  expect(await hear(hum, " Vielen Dank.")).toEqual(nothing(1));
  expect(await hear(hum, " Spannungsgeladene", { logprob: -0.6 })).toEqual(nothing(1));
  expect((await hear(hum, " Ja.", { logprob: -0.1 })).text).toBe("Ja.");
  expect((await hear(spoken, " Spannungsgeladene", { logprob: -0.6 })).text).toBe(
    "Spannungsgeladene",
  );
  const tap = wav(quiet, { ms: 160, amplitude: 0.5 }, quiet);
  expect(await hear(tap, " Vielen Dank.", { logprob: -0.58 })).toEqual(nothing(1));
  // Credits at any loudness; sounds Whisper names, and punctuation alone.
  expect(await hear(spoken, " Untertitelung des ZDF, 2020", { logprob: -0.2 })).toEqual(nothing(1));
  expect(await hear(spoken, " Untertitel im Auftrag des ZDF, 2017")).toEqual(nothing(1));
  expect(await hear(spoken, " * Musik *")).toEqual(nothing(1));
  expect(await hear(spoken, " [Musik]")).toEqual(nothing(1));
  expect(await hear(spoken, " ...")).toEqual(nothing(1));
  expect((await hear(spoken, " (lacht) Ja, gut.")).text).toBe("Ja, gut.");
  // Anything else is kept, a phrase of another language's list too.
  expect((await hear(faint, " Ja.")).text).toBe("Ja.");
  expect((await hear(faint, " Thank you.")).text).toBe("Thank you.");
});

test("speech: the engine is asked for verbose_json in the language given, never with the line to say", async () => {
  const m = machine(" Danke.", -0.1);
  const { app, cookie, sendJson } = await setup({ fetch: m.fetch, speech: m.host });
  await sendJson("POST", "/api/speech/models/small-q5_1", {});
  await app.request("/api/speech/transcribe?lang=de&expect=Danke!", {
    method: "POST",
    headers: { cookie, "content-type": "audio/wav", ...CLIENT_HEADERS },
    body: wav({ ms: 400, amplitude: 0.1 }),
  });
  const form = m.sent[0] as FormData;
  expect(form.get("response_format")).toBe("verbose_json");
  expect(form.get("language")).toBe("de");
  expect([...form.keys()].sort()).toEqual(["file", "language", "response_format", "temperature"]);
});
