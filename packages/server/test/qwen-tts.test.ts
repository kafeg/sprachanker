import { expect, test } from "bun:test";
import { setup } from "./setup.ts";
import { qwen } from "./speech-fakes.ts";

test("Qwen3-TTS: a model downloaded with its codec; a text said in its language by the profile's speaker", async () => {
  const q = qwen();
  const { getJson, send, sendJson } = await setup({ speech: q.host });
  const before = await getJson("/api/speech/qwen");
  expect(before.engine).toBe(true);
  expect(before.languages).toContain("de");
  expect(before.speakers).toContain("ryan");
  const small = before.models.find((m: { id: string }) => m.id === "0.6b");
  // Its size counts the codec it needs too.
  expect(small.bytes).toBe(968_588_544 + 291_150_624);

  await sendJson("POST", "/api/speech/qwen/models/0.6b", {});
  await new Promise((r) => setTimeout(r, 10));
  expect(q.files).toEqual([
    "qwen-tokenizer-12hz-Q8_0.gguf",
    "qwen-talker-0.6b-customvoice-Q8_0.gguf",
  ]);
  expect((await getJson("/api/speech/qwen")).models[0]).toMatchObject({
    installed: true,
    inUse: true,
  });

  await send("PUT", "/api/settings", { key: "speech.readEngine", value: "qwen" });
  await send("PUT", "/api/settings", { key: "speech.voices", value: { qwen: { de: "serena" } } });
  const wav = await send("POST", "/api/speech/say", { text: "Guten Tag!", lang: "de" });
  expect(wav.status).toBe(200);
  expect(await wav.text()).toBe("Guten Tag!");
  expect(q.asked[0]).toMatchObject({
    input: "Guten Tag!",
    voice: "serena",
    language: "German",
    response_format: "wav",
  });
  // Each language its own speaker: English has none chosen, the default reads it, in English.
  await send("POST", "/api/speech/say", { text: "Hello", lang: "en" });
  expect(q.asked[1]).toMatchObject({ voice: "ryan", language: "English" });
  // A language is always given, never detected: a mix is no more asked for.
  expect(
    (await send("POST", "/api/speech/say", { text: "Hallo", lang: "de", langs: ["ru", "de"] }))
      .status,
  ).toBe(200);
  expect(q.asked[2]).toMatchObject({ voice: "serena", language: "German" });
  await send("PUT", "/api/settings", { key: "speech.voices", value: {} });
  await send("POST", "/api/speech/say", { text: "Hallo", lang: "de" });
  expect(q.asked[3]).toMatchObject({ voice: "ryan", language: "German" });
  expect(q.spawned()).toBe(1);

  // A language Qwen3-TTS does not speak.
  expect((await send("POST", "/api/speech/say", { text: "مرحبا", lang: "ar" })).status).toBe(409);
  // The last model removed takes the codec with it.
  await send("DELETE", "/api/speech/qwen/models/0.6b", {});
  expect(q.files).toEqual([]);
});

test("Qwen3-TTS: both models downloaded at once fetch the codec once; removing one keeps the codec the other needs", async () => {
  const q = qwen();
  /** Downloads that end when the test says: by file, in the order asked. */
  const asked: string[] = [];
  const finish = new Map<string, () => void>();
  q.host.models.download = (_url, model) => {
    asked.push(model.file);
    return new Promise<void>((resolve) =>
      finish.set(model.file, () => {
        q.files.push(model.file);
        resolve();
      }),
    );
  };
  const { getJson, send, sendJson } = await setup({ speech: q.host });
  const tick = () => new Promise((r) => setTimeout(r, 10));
  await sendJson("POST", "/api/speech/qwen/models/0.6b", {});
  await sendJson("POST", "/api/speech/qwen/models/1.7b", {});
  await tick();
  expect(asked).toEqual(["qwen-tokenizer-12hz-Q8_0.gguf"]);
  finish.get("qwen-tokenizer-12hz-Q8_0.gguf")?.();
  await tick();
  expect(asked.slice(1).sort()).toEqual([
    "qwen-talker-0.6b-customvoice-Q8_0.gguf",
    "qwen-talker-1.7b-customvoice-Q8_0.gguf",
  ]);
  finish.get("qwen-talker-0.6b-customvoice-Q8_0.gguf")?.();
  await tick();
  // The small one removed while the large one still comes: the codec stays for it.
  expect((await send("DELETE", "/api/speech/qwen/models/0.6b", undefined)).status).toBe(200);
  expect(q.files).toContain("qwen-tokenizer-12hz-Q8_0.gguf");
  finish.get("qwen-talker-1.7b-customvoice-Q8_0.gguf")?.();
  await tick();
  const large = (await getJson("/api/speech/qwen")).models.find(
    (m: { id: string }) => m.id === "1.7b",
  );
  expect(large).toMatchObject({ installed: true, inUse: true });
});

test("Qwen3-TTS: both models there, the large one is used unless the profile chose the small one", async () => {
  const q = qwen([
    "qwen-tokenizer-12hz-Q8_0.gguf",
    "qwen-talker-0.6b-customvoice-Q8_0.gguf",
    "qwen-talker-1.7b-customvoice-Q8_0.gguf",
  ]);
  const { getJson, send } = await setup({ speech: q.host });
  const inUse = async () =>
    (await getJson("/api/speech/qwen")).models
      .filter((m: { inUse: boolean }) => m.inUse)
      .map((m: { id: string }) => m.id);
  expect(await inUse()).toEqual(["1.7b"]);
  await send("PUT", "/api/settings", { key: "speech.qwenModel", value: "0.6b" });
  expect(await inUse()).toEqual(["0.6b"]);
  await send("PUT", "/api/settings", { key: "speech.readEngine", value: "qwen" });
  expect((await send("POST", "/api/speech/say", { text: "Hallo", lang: "de" })).status).toBe(200);
  expect(q.talkers).toEqual(["/models/qwen-talker-0.6b-customvoice-Q8_0.gguf"]);
});
