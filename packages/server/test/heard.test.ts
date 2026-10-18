// The source's answers heard into the course: a lesson's as it asks for them, a course's in one go;
// the answers said aloud then checked against them by the server, without a model.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { openLibrary } from "@sprachanker/course-kit";
import { nodeFs } from "@sprachanker/course-kit/node";
import { CourseHeard } from "@sprachanker/schema";
import { ulid } from "ulid";
import { mediaBlob } from "../src/runtime/bun.ts";
import { createContent } from "../src/services/content.ts";
import { createHeard } from "../src/services/heard.ts";
import type { SpeechHost } from "../src/services/local-engines.ts";
import { createSpeech } from "../src/services/speech.ts";
import { setup } from "./setup.ts";
import { heardFiles } from "./storage.ts";

const LESSON = `${FIXTURE_SERIES}/demo/00-02`;
const EXERCISE = `${LESSON}/ex-02`;
const FRAMED = "media/audio/guten-abend-danke.mp3";
const FREE = "media/audio/hallo-guten-tag.mp3";

/** Whisper installed: what it hears of a fixture recording is said by its name (`said`). */
function machine(said: Record<string, string>) {
  const heard: string[] = [];
  const speech: SpeechHost = {
    freePort: async () => 9913,
    whisper: {
      binary: () => "/opt/whisper-server",
      spawn: () => ({ exited: new Promise(() => {}), kill() {} }),
    },
    models: { path: (file) => `/models/${file}`, async download() {}, remove() {} },
  };
  const fetch = (async (url: string, init: RequestInit) => {
    if (url === "http://127.0.0.1:9913/health") return new Response("ok");
    if (url === "http://127.0.0.1:9913/inference") {
      const file = (init.body as FormData).get("file") as Blob;
      const name = (await file.text()).replace("sprachanker-fixture:", "");
      heard.push(name);
      return Response.json({ text: ` ${said[name] ?? ""}\n` });
    }
    return new Response("no", { status: 500 });
  }) as unknown as typeof globalThis.fetch;
  return { speech, fetch, heard };
}

const SAID = {
  "guten-abend-danke.mp3": "Guten Abend! Danke, gut. Und dir?",
  "hallo-guten-tag.mp3": "Hallo! Guten Tag!",
};

test("a lesson's answer recordings heard the first time it asks, written into the course, then checked against", async () => {
  const m = machine(SAID);
  const api = await setup({ fetch: m.fetch, speech: m.speech });
  const { getJson, sendJson, root } = api;
  const url = `/api/lesson/heard?${new URLSearchParams({ series: FIXTURE_SERIES, key: LESSON })}`;
  expect((await getJson(url)).heard).toEqual({
    [FRAMED]: "Guten Abend! Danke, gut. Und dir?",
    [FREE]: "Hallo! Guten Tag!",
  });
  const file = join(root, "library", FIXTURE_SERIES, "heard/demo.json");
  const stored = CourseHeard.parse(JSON.parse(readFileSync(file, "utf8")));
  expect(stored).toMatchObject({ course: `${FIXTURE_SERIES}/demo`, lang: "de" });
  expect(stored.recordings[FRAMED]?.model).toBe("large-v3-turbo-q5_0");
  // Asked again: from the course, nothing heard anew.
  await getJson(url);
  expect(m.heard.sort()).toEqual(["guten-abend-danke.mp3", "hallo-guten-tag.mp3"]);

  // The server's outcome of an answer said aloud: judged against it, in no score.
  const { run } = await sendJson("POST", "/api/runs", {
    series: FIXTURE_SERIES,
    lessonKey: LESSON,
    edition: "ru-de",
  });
  const answered = (transcript: string) => ({
    id: ulid(),
    type: "answered",
    itemKey: `${EXERCISE}#3`,
    payload: { answer: { transcript }, attempt: 1, ms: 1000 },
  });
  const wrong = await sendJson("POST", `/api/runs/${run.id}/events`, {
    events: [answered("Guten Abend! Wie geht es dir?")],
  });
  expect(Object.values(wrong.outcomes)[0]).toMatchObject({
    result: "unscored",
    score: 0,
    spoken: "wrong",
  });
  const right = await sendJson("POST", `/api/runs/${run.id}/events`, {
    events: [answered("Guten Abend, danke gut, und dir")],
  });
  expect(Object.values(right.outcomes)[0]).toMatchObject({ spoken: "correct" });
});

test("a profile that hears no speech gets what is there, nothing heard for it", async () => {
  const m = machine(SAID);
  const { getJson, send } = await setup({ fetch: m.fetch, speech: m.speech });
  await send("PUT", "/api/settings", { key: "speech.recognition", value: false });
  const url = `/api/lesson/heard?${new URLSearchParams({ series: FIXTURE_SERIES, key: LESSON })}`;
  expect((await getJson(url)).heard).toEqual({});
  expect(m.heard).toEqual([]);
});

test("a course heard in one go: counted, a recording that completes none of its item's frame not used, heard again on request", async () => {
  const m = machine({ ...SAID, "guten-abend-danke.mp3": "Guten Abend." });
  const { root } = await setup();
  const library = openLibrary(nodeFs, join(root, "library"));
  const heard = createHeard({
    library,
    content: createContent(library),
    speech: createSpeech({ host: m.speech, fetch: m.fetch }),
    files: heardFiles(root),
    mediaBlob,
    now: () => 5,
  });
  const report = await heard.course(FIXTURE_SERIES, "demo");
  expect(report).toMatchObject({
    course: `${FIXTURE_SERIES}/demo`,
    items: 2,
    recordings: 2,
    heard: 2,
    reused: 0,
    failed: 0,
    used: 1,
    notUsed: 1,
  });
  // Again: nothing left to hear; with `again`, every one heard anew.
  expect((await heard.course(FIXTURE_SERIES, "demo")).heard).toBe(0);
  expect((await heard.course(FIXTURE_SERIES, "demo", { again: true })).heard).toBe(2);
  expect(existsSync(join(root, "library", FIXTURE_SERIES, "heard/demo.json"))).toBe(true);
});
