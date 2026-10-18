// The source's answers heard into the course: a lesson's as it asks for them, a course's in one go;
// the answers said aloud then checked against them by the server, without a model.
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { openLibrary } from "@sprachanker/course-kit";
import { nodeFs } from "@sprachanker/course-kit/node";
import { CourseHeard, type LessonKey } from "@sprachanker/schema";
import { ulid } from "ulid";
import { mediaBlob } from "../src/runtime/bun.ts";
import { createContent } from "../src/services/content.ts";
import { createHeard, type HeardFiles } from "../src/services/heard.ts";
import { createSpeech } from "../src/services/speech.ts";
import { setup } from "./setup.ts";
import { whisper as machine, SAID } from "./speech-fakes.ts";
import { heardFiles, withSeriesLock } from "./storage.ts";

const LESSON = `${FIXTURE_SERIES}/demo/00-02`;
const EXERCISE = `${LESSON}/ex-02`;
const FRAMED = "media/audio/guten-abend-danke.mp3";
const FREE = "media/audio/hallo-guten-tag.mp3";
const MODEL = "large-v3-turbo-q5_0";
const url = `/api/lesson/heard?${new URLSearchParams({ series: FIXTURE_SERIES, key: LESSON })}`;

/** Until `done` holds (the background's work), a few seconds at most. */
/** Waits for `done` (a check that throws counts as not yet: a file still being written), up to 10 s
 *  — the background writes run late on a loaded machine. */
async function until(done: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 2000; i++) {
    if (
      await Promise.resolve()
        .then(done)
        .catch(() => false)
    )
      return;
    await Bun.sleep(5);
  }
  throw new Error("never done");
}

/** What a lesson's request gives once nothing is being heard any more. */
async function heardAll(ask: () => Promise<{ heard: Record<string, string>; hearing: boolean }>) {
  let last = await ask();
  await until(async () => {
    last = await ask();
    return !last.hearing;
  });
  return last.heard;
}

const fileOf = (root: string) => join(root, "library", FIXTURE_SERIES, "heard/demo.json");

/** The heard service over a test library, `files` its writes. */
async function service(m: ReturnType<typeof machine>, files?: (root: string) => HeardFiles) {
  const { root } = await setup();
  const library = openLibrary(nodeFs, join(root, "library"));
  const heard = createHeard({
    library,
    content: createContent(library),
    speech: createSpeech({ host: m.speech, fetch: m.fetch }),
    files: (files ?? heardFiles)(root),
    mediaBlob,
    now: () => 5,
    sleep: async () => {},
  });
  const lesson = () => heard.lesson(FIXTURE_SERIES, LESSON as LessonKey, MODEL);
  return { root, heard, lesson };
}

test("a lesson's answer recordings heard the first time it asks, written into the course, then checked against", async () => {
  const m = machine(SAID);
  const api = await setup({ fetch: m.fetch, speech: m.speech });
  const { getJson, sendJson, root } = api;
  expect(await heardAll(() => getJson(url))).toEqual({
    [FRAMED]: "Guten Abend! Danke, gut. Und dir?",
    [FREE]: "Hallo! Guten Tag!",
  });
  // Written as heard: a request meanwhile may write the first before the second is heard.
  const read = () => CourseHeard.parse(JSON.parse(readFileSync(fileOf(root), "utf8")));
  await until(() => existsSync(fileOf(root)) && Object.keys(read().recordings).length === 2);
  const stored = read();
  expect(stored).toMatchObject({ course: `${FIXTURE_SERIES}/demo`, lang: "de" });
  expect(stored.recordings[FRAMED]?.model).toBe(MODEL);
  // Asked again: from the course, nothing heard anew.
  expect(await getJson(url)).toMatchObject({ hearing: false });
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

  // Kept as before the engine judged spoken answers (no `spoken`): judged as the run is read —
  // the player's run, the Notebook's pass and item (the mistakes and the tutor read it alike).
  new Database(join(root, "profiles/local/profile.sqlite"))
    .query(
      "UPDATE events SET payload_json = json_set(payload_json, '$.outcome', json('{\"result\":\"unscored\",\"score\":0}')) WHERE type = 'answered'",
    )
    .run();
  const query = new URLSearchParams({ series: FIXTURE_SERIES, lessonKey: LESSON });
  const spokenOf = (events: Array<{ type: string; payload: { outcome?: { spoken?: string } } }>) =>
    events.filter((e) => e.type === "answered").map((e) => e.payload.outcome?.spoken);
  expect(spokenOf((await getJson(`/api/runs/lesson?${query}`)).state.events)).toEqual([
    "wrong",
    "correct",
  ]);
  expect(spokenOf((await getJson(`/api/notebook/passes/${run.id}`)).events)).toEqual([
    "wrong",
    "correct",
  ]);
  const item = await getJson(`/api/notebook/item?itemKey=${encodeURIComponent(`${EXERCISE}#3`)}`);
  expect(
    item.passes[0].answers.map((a: { outcome: { spoken?: string } }) => a.outcome.spoken),
  ).toEqual(["wrong", "correct"]);
});

test("a profile that hears no speech gets what is there, nothing heard for it", async () => {
  const m = machine(SAID);
  const { getJson, send } = await setup({ fetch: m.fetch, speech: m.speech });
  await send("PUT", "/api/settings", { key: "speech.recognition", value: false });
  expect(await getJson(url)).toEqual({ heard: {}, hearing: false });
  expect(m.heard).toEqual([]);
});

test("the series' lock held (a download) keeps no request waiting: answered from what was heard, written once it is let go", async () => {
  const m = machine(SAID);
  const api = await setup({ fetch: m.fetch, speech: m.speech });
  let release = () => {};
  const held = withSeriesLock(
    join(api.root, "library"),
    FIXTURE_SERIES,
    () => new Promise<void>((r) => (release = r)),
  );
  expect(Object.keys(await heardAll(() => api.getJson(url))).sort()).toEqual([FRAMED, FREE]);
  expect(existsSync(fileOf(api.root))).toBe(false);
  // The server checks answers by what it heard, not written yet.
  const { run } = await api.sendJson("POST", "/api/runs", {
    series: FIXTURE_SERIES,
    lessonKey: LESSON,
    edition: "ru-de",
  });
  const said = await api.sendJson("POST", `/api/runs/${run.id}/events`, {
    events: [
      {
        id: ulid(),
        type: "answered",
        itemKey: `${EXERCISE}#3`,
        payload: { answer: { transcript: "Guten Abend, danke gut, und dir" }, attempt: 1, ms: 1 },
      },
    ],
  });
  expect(Object.values(said.outcomes)[0]).toMatchObject({ spoken: "correct" });
  release();
  await held;
  await until(() => existsSync(fileOf(api.root)));
});

test("a write another process refused is kept and tried again; a recording that failed is not heard again", async () => {
  const m = machine(SAID, ["hallo-guten-tag.mp3"]);
  let busy = true;
  const { root, lesson } = await service(m, (root) => ({
    ...heardFiles(root),
    add: (series, heard) =>
      busy
        ? Promise.reject(Object.assign(new Error("busy"), { code: "SERIES_BUSY" }))
        : heardFiles(root).add(series, heard),
  }));
  expect(await heardAll(lesson)).toEqual({ [FRAMED]: "Guten Abend! Danke, gut. Und dir?" });
  expect(existsSync(fileOf(root))).toBe(false);
  busy = false;
  expect(await lesson()).toMatchObject({ hearing: false });
  await until(() => existsSync(fileOf(root)));
  expect(m.heard.sort()).toEqual(["guten-abend-danke.mp3", "hallo-guten-tag.mp3"]);
});

test("what Whisper adds is left out; a transcript longer than a file keeps fails alone", async () => {
  const m = machine({
    "guten-abend-danke.mp3":
      "Guten Abend! Danke, gut. Und dir? Untertitel im Auftrag des ZDF, 2020",
    "hallo-guten-tag.mp3": "Hallo ".repeat(1000),
  });
  const { root, lesson } = await service(m);
  expect(await heardAll(lesson)).toEqual({ [FRAMED]: "Guten Abend! Danke, gut. Und dir?" });
  await until(() => existsSync(fileOf(root)));
  expect(
    Object.keys(CourseHeard.parse(JSON.parse(readFileSync(fileOf(root), "utf8"))).recordings),
  ).toEqual([FRAMED]);
});

test("a file of recordings heard that does not read: answers checked without it, heard anew over it", async () => {
  const m = machine(SAID);
  const api = await setup({ fetch: m.fetch, speech: m.speech });
  mkdirSync(join(api.root, "library", FIXTURE_SERIES, "heard"), { recursive: true });
  writeFileSync(fileOf(api.root), '{"format": 9');
  const { run } = await api.sendJson("POST", "/api/runs", {
    series: FIXTURE_SERIES,
    lessonKey: LESSON,
    edition: "ru-de",
  });
  const res = await api.send("POST", `/api/runs/${run.id}/events`, {
    events: [
      {
        id: ulid(),
        type: "answered",
        itemKey: `${EXERCISE}#3`,
        payload: { answer: { transcript: "Guten Abend" }, attempt: 1, ms: 1 },
      },
    ],
  });
  expect(res.status).toBe(200);
  expect(Object.keys(await heardAll(() => api.getJson(url))).sort()).toEqual([FRAMED, FREE]);
  await until(
    () => CourseHeard.safeParse(JSON.parse(readFileSync(fileOf(api.root), "utf8"))).success,
  );
});

test("a course heard in one go: counted, a recording that completes none of its item's frame not used, heard again on request", async () => {
  const m = machine({ ...SAID, "guten-abend-danke.mp3": "Guten Abend." });
  const { root, heard } = await service(m);
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
  expect(existsSync(fileOf(root))).toBe(true);
});
