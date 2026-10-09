import { expect, test } from "bun:test";
import type { PiperHost, PiperVoice } from "../src/services/read-aloud.ts";
import { setup } from "./setup.ts";

/** A Piper host on paper: voices installed by id, what it was asked to say, a WAV per text. */
function piper(installed: string[], built = true) {
  const said: Array<{ key: string; id: string; text: string; lengthScale: number }> = [];
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
    async say(key, run) {
      said.push({ key, id: run.id, text: run.text, lengthScale: run.lengthScale });
      return new Uint8Array([82, 73, 70, 70]);
    },
  };
  return { host, said, downloaded };
}

test("reading aloud with Piper: the voices offered, one downloaded; a text said as a WAV with the best voice or the profile's", async () => {
  const p = piper(["de_DE-thorsten-medium"]);
  const { getJson, send, sendJson } = await setup({ piper: p.host });
  const state = await getJson("/api/speech/voices");
  expect(state.engine).toBe(true);
  const thorsten = state.voices.find((v: { id: string }) => v.id === "de_DE-thorsten-medium");
  expect(thorsten).toMatchObject({
    lang: "de",
    name: "thorsten",
    quality: "medium",
    installed: true,
  });
  expect(state.voices.some((v: { lang: string }) => v.lang === "ru")).toBe(true);

  await sendJson("POST", "/api/speech/voices/de_DE-thorsten-high", {});
  expect(p.downloaded).toEqual(["de_DE-thorsten-high"]);

  const say = (text: string) => send("POST", "/api/speech/say", { text, lang: "de" });
  const wav = await say("Guten Tag!");
  expect(wav.headers.get("content-type")).toBe("audio/wav");
  expect(new Uint8Array(await wav.arrayBuffer())).toEqual(new Uint8Array([82, 73, 70, 70]));
  // The best installed: high before medium; at the profile's speed (slower: a longer length).
  expect(p.said.at(-1)).toMatchObject({
    id: "de_DE-thorsten-high",
    text: "Guten Tag!",
    lengthScale: 1,
  });
  await send("PUT", "/api/settings", { key: "speech.readRate", value: 0.8 });
  await send("PUT", "/api/settings", {
    key: "speech.voices",
    value: { piper: { de: "de_DE-thorsten-medium" } },
  });
  await say("Guten Tag!");
  expect(p.said.at(-1)).toMatchObject({ id: "de_DE-thorsten-medium", lengthScale: 1.25 });
  // Kept by voice, speed and text: the same reading has the same key.
  expect(p.said[0]?.key).not.toBe(p.said[1]?.key);

  // No voice of the language, or no engine: it cannot be read.
  expect((await send("POST", "/api/speech/say", { text: "Привет", lang: "ru" })).status).toBe(409);
  expect((await send("POST", "/api/speech/voices/nope", {})).status).toBe(404);
});

test("without the engine built: voices listed, nothing said", async () => {
  const { getJson, send } = await setup({ piper: piper(["de_DE-thorsten-medium"], false).host });
  expect((await getJson("/api/speech/voices")).engine).toBe(false);
  expect((await send("POST", "/api/speech/say", { text: "Hallo", lang: "de" })).status).toBe(409);
});
