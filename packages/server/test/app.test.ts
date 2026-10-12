import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { openLibrary } from "@sprachanker/course-kit";
import { CLIENT_HEADERS, type LessonKey } from "@sprachanker/schema";
import { ulid } from "ulid";
import { directoryAssets, fileAssets } from "../src/runtime/bun.ts";
import { createContent } from "../src/services/content.ts";
import type { CourseInstaller } from "../src/services/downloads.ts";
import { createLessons } from "../src/services/lessons.ts";
import { createRunStore } from "../src/services/run-store.ts";
import { setup } from "./setup.ts";

const COURSE = { series: FIXTURE_SERIES, course: "demo", edition: "ru-de" };
const LESSON = "sprachanker.fixture/demo/00-01";

type Api = Awaited<ReturnType<typeof setup>>;
/** Skips every item of the lesson's exercises not in `worked`, so the run can be completed. */
async function skipRest({ getJson, sendJson }: Api, runId: string, worked: string[] = []) {
  const { lesson } = await getJson(
    `/api/lesson?${new URLSearchParams({ series: FIXTURE_SERIES, key: LESSON, edition: "ru-de" })}`,
  );
  const events = lesson.pages
    .filter((p: { exercise: { key: string } }) => !worked.includes(p.exercise.key))
    .flatMap((p: { exercise: { items: Array<{ key: string }> } }) =>
      p.exercise.items.map((item) => ({
        id: ulid(),
        type: "item_skipped",
        itemKey: item.key,
        payload: {},
      })),
    );
  await sendJson("POST", `/api/runs/${runId}/events`, { events });
}

/** Records the lesson's reading steps (words, grammar, culture of the fixture lesson) as done. */
async function readSteps({ sendJson }: Api, runId: string) {
  const events = ["words", "grammar:0", "culture:0"].map((step) => ({
    id: ulid(),
    type: "step_done",
    payload: { step },
  }));
  await sendJson("POST", `/api/runs/${runId}/events`, { events });
}

describe("web app", () => {
  test("health, index, hashed assets, client routes, unknown api", async () => {
    const { get, getJson } = await setup();
    expect(await getJson("/api/health")).toEqual({ status: "ok", version: "test" });
    const index = await get("/");
    expect(index.headers.get("cache-control")).toBe("no-cache");
    expect((await get("/assets/app-1a2b.js")).headers.get("cache-control")).toContain("immutable");
    expect(await (await get("/course/a1/lesson/3")).text()).toBe("<!doctype html>");
    expect((await get("/missing.png")).status).toBe(404);
    expect((await get("/api/nope")).status).toBe(404);
  });
});

describe("courses and lessons", () => {
  test("installed courses, the course map and a lesson", async () => {
    const { getJson } = await setup();
    const courses = await getJson("/api/courses");
    expect(courses).toEqual([
      {
        series: FIXTURE_SERIES,
        course: "demo",
        key: "sprachanker.fixture/demo",
        editions: ["en-de", "ru-de"],
        titles: { "en-de": "Demo course", "ru-de": "Демо-курс" },
        lessons: 2,
        done: 0,
        next: "sprachanker.fixture/demo/00-01",
        nextStarted: false,
        started: false,
        nextTitles: { "en-de": "Im Café", "ru-de": "Im Café" },
        nextRun: null,
        source: null,
      },
    ]);
    const map = await getJson(`/api/course?${new URLSearchParams(COURSE)}`);
    expect(map.titles[LESSON]).toBe("Im Café");
    expect(map.lessons).toEqual({});
    const { lesson, locale } = await getJson(
      `/api/lesson?${new URLSearchParams({ series: FIXTURE_SERIES, key: LESSON, edition: "en-de" })}`,
    );
    expect(lesson.key).toBe(LESSON);
    expect(locale.edition).toBe("en-de");
  });

  test("bad queries are rejected; what is not installed is 404", async () => {
    const { get } = await setup();
    expect((await get(`/api/lesson?series=x&key=nope&edition=ru-de`)).status).toBe(400);
    const lesson = new URLSearchParams({
      series: FIXTURE_SERIES,
      key: `${FIXTURE_SERIES}/demo/09-09`,
      edition: "ru-de",
    });
    expect((await get(`/api/lesson?${lesson}`)).status).toBe(404);
    const course = new URLSearchParams({
      series: FIXTURE_SERIES,
      course: "nope",
      edition: "ru-de",
    });
    expect((await get(`/api/course?${course}`)).status).toBe(404);
    expect((await get(`/api/course?series=${FIXTURE_SERIES}&course=..&edition=ru-de`)).status).toBe(
      400,
    );
  });
});

describe("runs", () => {
  test("mutations need the client header", async () => {
    const { app } = await setup();
    const res = await app.request("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  test("opening a lesson starts nothing; skips are stored; a finished run is shown; restart", async () => {
    const api = await setup();
    const { getJson, sendJson, send } = api;
    const q = new URLSearchParams({ series: FIXTURE_SERIES, lessonKey: LESSON });
    expect((await getJson(`/api/runs/lesson?${q}`)).state).toBeNull();
    expect((await getJson("/api/courses"))[0].nextStarted).toBe(false);

    const body = { series: FIXTURE_SERIES, lessonKey: LESSON, edition: "ru-de" };
    const { run } = await sendJson("POST", "/api/runs", body);
    // Opened, nothing done and no completed run: the course map leaves the lesson out.
    const opened = await getJson(`/api/course?${new URLSearchParams(COURSE)}`);
    expect(opened.lessons[LESSON]).toBeUndefined();
    const skipped = { id: ulid(), type: "item_skipped", itemKey: `${LESSON}/ex-01#2`, payload: {} };
    await sendJson("POST", `/api/runs/${run.id}/events`, { events: [skipped] });
    const active = (await getJson(`/api/runs/lesson?${q}`)).state;
    expect([active.run.id, active.run.status, active.events[0].type]).toEqual([
      run.id,
      "active",
      "item_skipped",
    ]);

    // A run with exercises left is not complete.
    expect((await send("POST", `/api/runs/${run.id}/finish`, {})).status).toBe(409);
    await skipRest(api, run.id);
    // The exercises are worked; the words, grammar and culture steps are still to do.
    expect((await send("POST", `/api/runs/${run.id}/finish`, {})).status).toBe(409);
    await readSteps(api, run.id);
    await sendJson("POST", `/api/runs/${run.id}/finish`, {});
    const done = (await getJson(`/api/runs/lesson?${q}`)).state;
    expect([done.run.id, done.run.status]).toEqual([run.id, "finished"]);
    // Skipped items are not answers; skipped checked items count as wrong (10 of them in the fixture).
    expect(done.run.result).toEqual({ score: 0, scored: 10, answered: 0 });

    const again = await sendJson("POST", "/api/runs", { ...body, restart: true });
    expect(again.run.id).not.toBe(run.id);
    expect(again.events).toEqual([]);
    expect((await getJson(`/api/runs/lesson?${q}`)).state.run.id).toBe(again.run.id);
    // Started over with nothing done yet: the map shows the completed run, as the course counts it.
    const before = await getJson(`/api/course?${new URLSearchParams(COURSE)}`);
    expect(before.lessons[LESSON]).toMatchObject({ done: true, run: { status: "finished" } });
    const first = { id: ulid(), type: "item_skipped", itemKey: `${LESSON}/ex-01#1`, payload: {} };
    await sendJson("POST", `/api/runs/${again.run.id}/events`, { events: [first] });
    expect((await getJson(`/api/runs/lesson?${q}`)).state.run.id).toBe(again.run.id);
    const map = await getJson(`/api/course?${new URLSearchParams(COURSE)}`);
    expect(map.lessons[LESSON]).toMatchObject({ done: true, run: { status: "active", worked: 1 } });
  });

  test("a lesson with only a step done (its words, a page read) is in progress", async () => {
    const { getJson, sendJson } = await setup();
    const { run } = await sendJson("POST", "/api/runs", {
      series: FIXTURE_SERIES,
      lessonKey: LESSON,
      edition: "ru-de",
    });
    expect((await getJson("/api/courses"))[0].nextStarted).toBe(false);
    await sendJson("POST", `/api/runs/${run.id}/events`, {
      events: [{ id: ulid(), type: "step_done", payload: { step: "words" } }],
    });
    expect((await getJson("/api/courses"))[0].nextStarted).toBe(true);
  });

  test("start, answer (outcomes by the server, idempotent), resume, finish, progress", async () => {
    const api = await setup();
    const { send, getJson, sendJson } = api;
    const started = await sendJson("POST", "/api/runs", {
      series: FIXTURE_SERIES,
      lessonKey: LESSON,
      edition: "ru-de",
    });
    const runId = started.run.id;
    expect(started.resumePage).toBe(0);

    const shown = { id: ulid(), type: "page_shown", payload: { pageIndex: 0 } };
    const right = {
      id: ulid(),
      type: "answered",
      itemKey: `${LESSON}/ex-01#1`,
      payload: { answer: { optionId: "a" }, attempt: 1, ms: 900, outcome: { result: "wrong" } },
    };
    const wrong = {
      id: ulid(),
      type: "answered",
      itemKey: `${LESSON}/ex-01#2`,
      payload: { answer: { optionId: "a" }, attempt: 1, ms: 700 },
    };
    const retry = {
      id: ulid(),
      type: "answered",
      itemKey: `${LESSON}/ex-01#2`,
      payload: { answer: { optionId: "b" }, attempt: 2, ms: 500 },
    };
    const { outcomes } = await sendJson("POST", `/api/runs/${runId}/events`, {
      events: [shown, right, wrong, retry],
    });
    expect([
      outcomes[right.id].result,
      outcomes[wrong.id].result,
      outcomes[retry.id].result,
    ]).toEqual(["correct", "wrong", "correct"]);

    // Sent again (a lost response): stored once, its stored outcome returned.
    const again = await sendJson("POST", `/api/runs/${runId}/events`, {
      events: [right, right, { id: ulid(), type: "page_shown", payload: { pageIndex: 2 } }],
    });
    expect(again.outcomes).toEqual({ [right.id]: outcomes[right.id] });
    expect(again.attempts).toEqual({ [right.id]: 1 });

    // A batch with an event that does not fit stores nothing of it.
    const before = (
      await sendJson("POST", "/api/runs", {
        series: FIXTURE_SERIES,
        lessonKey: LESSON,
        edition: "ru-de",
      })
    ).events.length;
    const bad = await send("POST", `/api/runs/${runId}/events`, {
      events: [
        { id: ulid(), type: "page_shown", payload: { pageIndex: 3 } },
        { id: ulid(), type: "item_skipped", itemKey: `${LESSON}/ex-99#1`, payload: {} },
      ],
    });
    expect(bad.status).toBe(400);
    expect(
      (
        await sendJson("POST", "/api/runs", {
          series: FIXTURE_SERIES,
          lessonKey: LESSON,
          edition: "ru-de",
        })
      ).events,
    ).toHaveLength(before);

    const resumed = await sendJson("POST", "/api/runs", {
      series: FIXTURE_SERIES,
      lessonKey: LESSON,
      edition: "ru-de",
    });
    expect(resumed.run.id).toBe(runId);
    expect(resumed.resumePage).toBe(2);
    expect(resumed.events).toHaveLength(5);
    expect(resumed.events[0].payload.snapshot.exercise.key).toBe(`${LESSON}/ex-01`);

    await skipRest(api, runId, [`${LESSON}/ex-01`]);
    await readSteps(api, runId);
    const finished = await sendJson("POST", `/api/runs/${runId}/finish`, {});
    expect(finished.status).toBe("finished");
    // One of two answered right; the 8 checked items skipped count 0.
    expect(finished.result).toEqual({ score: 1 / 10, scored: 10, answered: 2 });
    const map = await getJson(`/api/course?${new URLSearchParams(COURSE)}`);
    const total = map.lessons[LESSON].run.total;
    expect(map.lessons[LESSON]).toEqual({
      done: true,
      run: { status: "finished", worked: total, total, score: 1 / 10 },
    });
    expect((await send("POST", `/api/runs/${runId}/events`, { events: [] })).status).toBe(409);
  });

  test("an answer's attempt is numbered by the server: two devices never give two answers one number", async () => {
    const { sendJson } = await setup();
    const body = { series: FIXTURE_SERIES, lessonKey: LESSON, edition: "ru-de" };
    const { run } = await sendJson("POST", "/api/runs", body);
    const answer = () => ({
      id: ulid(),
      type: "answered",
      itemKey: `${LESSON}/ex-01#1`,
      // Each device counts it its first try.
      payload: { answer: { optionId: "a" }, attempt: 1, ms: 900 },
    });
    const here = answer();
    const there = answer();
    const first = await sendJson("POST", `/api/runs/${run.id}/events`, { events: [here] });
    expect(first.attempts).toEqual({ [here.id]: 1 });
    // The other device's, sent with the first again (a lost response): it is the second.
    const second = await sendJson("POST", `/api/runs/${run.id}/events`, { events: [here, there] });
    expect(second.attempts).toEqual({ [here.id]: 1, [there.id]: 2 });
  });

  test("a completed run stays completed when its lesson gains an exercise (a course normalised again)", async () => {
    const api = await setup();
    const { sendJson, root, profile } = api;
    const body = { series: FIXTURE_SERIES, lessonKey: LESSON, edition: "ru-de" };
    const { run } = await sendJson("POST", "/api/runs", body);
    await skipRest(api, run.id);
    await readSteps(api, run.id);
    expect((await sendJson("POST", `/api/runs/${run.id}/finish`, {})).status).toBe("finished");
    // The lesson's file gains an exercise; the runs read it afresh.
    const series = join(root, "library", FIXTURE_SERIES);
    const file = [
      ...new Bun.Glob("canonical/**/00-01.json").scanSync({ cwd: series }),
    ][0] as string;
    const lesson = JSON.parse(readFileSync(join(series, file), "utf8"));
    const last = lesson.pages.at(-1);
    const key = `${LESSON}/ex-99`;
    lesson.pages.push({
      ...last,
      exercise: {
        ...last.exercise,
        key,
        items: last.exercise.items.map((item: { key: string }, i: number) => ({
          ...item,
          key: `${key}#${i + 1}`,
        })),
      },
    });
    writeFileSync(join(series, file), JSON.stringify(lesson));
    const content = createContent(openLibrary(join(root, "library")));
    expect((await content.lesson(FIXTURE_SERIES, LESSON as LessonKey)).pages).toHaveLength(
      lesson.pages.length,
    );
    const runsNow = createLessons({
      store: createRunStore({ db: profile, now: Date.now, appVersion: "test" }),
      content,
    });
    expect((await runsNow.shown(LESSON as LessonKey))?.run.id).toBe(run.id);
    expect((await runsNow.progress())[LESSON]).toBeTruthy();
  });

  test("resetting progress: one lesson, then the whole course", async () => {
    const { getJson, sendJson, send } = await setup();
    const SECOND = "sprachanker.fixture/demo/00-02";
    for (const lessonKey of [LESSON, SECOND]) {
      const { run } = await sendJson("POST", "/api/runs", {
        series: FIXTURE_SERIES,
        lessonKey,
        edition: "ru-de",
      });
      const item = (
        await getJson(
          `/api/lesson?${new URLSearchParams({ series: FIXTURE_SERIES, key: lessonKey, edition: "ru-de" })}`,
        )
      ).lesson.pages[0].exercise.items[0].key;
      await sendJson("POST", `/api/runs/${run.id}/events`, {
        events: [{ id: ulid(), type: "item_skipped", itemKey: item, payload: {} }],
      });
    }
    const map = async () =>
      Object.keys((await getJson(`/api/course?${new URLSearchParams(COURSE)}`)).lessons);
    expect(await map()).toEqual([LESSON, SECOND]);

    const course = { series: FIXTURE_SERIES, course: "demo" };
    expect(await sendJson("POST", "/api/progress/reset", { ...course, lesson: LESSON })).toEqual({
      runs: 1,
      events: 1,
      cards: 0,
    });
    expect(await map()).toEqual([SECOND]);
    // A lesson of another course is refused.
    const other = { series: FIXTURE_SERIES, course: "other", lesson: SECOND };
    expect((await send("POST", "/api/progress/reset", other)).status).toBe(400);

    expect(await sendJson("POST", "/api/progress/reset", course)).toEqual({
      runs: 1,
      events: 1,
      cards: 0,
    });
    expect(await map()).toEqual([]);
    expect((await getJson("/api/courses"))[0]).toMatchObject({ done: 0, nextStarted: false });
  });

  test("opening the lesson in another edition ends the active run and starts a new one", async () => {
    const { sendJson } = await setup();
    const ru = await sendJson("POST", "/api/runs", {
      series: FIXTURE_SERIES,
      lessonKey: LESSON,
      edition: "ru-de",
    });
    const en = await sendJson("POST", "/api/runs", {
      series: FIXTURE_SERIES,
      lessonKey: LESSON,
      edition: "en-de",
    });
    expect(en.run.id).not.toBe(ru.run.id);
    expect(en.run.edition).toBe("en-de");
    const again = await sendJson("POST", "/api/runs", {
      series: FIXTURE_SERIES,
      lessonKey: LESSON,
      edition: "en-de",
    });
    expect(again.run.id).toBe(en.run.id);
  });

  test("a start that does not fit writes nothing; the lesson endpoints take lesson runs only", async () => {
    const { send, sendJson, getJson, root } = await setup();
    const runCount = () =>
      new Database(join(root, "profiles/local/profile.sqlite")).query("SELECT id FROM runs").all()
        .length;
    const { run } = await sendJson("POST", "/api/runs", {
      series: FIXTURE_SERIES,
      lessonKey: LESSON,
      edition: "ru-de",
    });
    const mismatch = await send("POST", "/api/runs", {
      series: "other.series",
      lessonKey: LESSON,
      edition: "en-de",
    });
    expect(mismatch.status).toBe(400);
    const missing = await send("POST", "/api/runs", {
      series: FIXTURE_SERIES,
      lessonKey: `${FIXTURE_SERIES}/demo/09-09`,
      edition: "ru-de",
    });
    expect(missing.status).toBe(404);
    expect(runCount()).toBe(1);
    // The active run is still the one started.
    const again = await sendJson("POST", "/api/runs", {
      series: FIXTURE_SERIES,
      lessonKey: LESSON,
      edition: "ru-de",
    });
    expect(again.run.id).toBe(run.id);
    // A review run (cards) is not a lesson run.
    await sendJson("POST", "/api/cards/lesson", {
      series: FIXTURE_SERIES,
      lessonKey: LESSON,
      edition: "ru-de",
    });
    const scope = encodeURIComponent(`lesson:ru-de:${LESSON}`);
    const card = (await getJson(`/api/cards/study?scope=${scope}`)).current;
    await sendJson("POST", `/api/cards/${card.cardId}/review`, {
      id: ulid(),
      face: card.face,
      rating: 3,
      reps: 0,
    });
    const review = new Database(join(root, "profiles/local/profile.sqlite"))
      .query<{ id: string }, []>("SELECT id FROM runs WHERE kind = 'review'")
      .get();
    expect((await send("POST", `/api/runs/${review?.id}/events`, { events: [] })).status).toBe(404);
    expect((await send("POST", `/api/runs/${review?.id}/finish`, {})).status).toBe(404);
  });

  test("an item from another lesson is refused", async () => {
    const { send, sendJson } = await setup();
    const { run } = await sendJson("POST", "/api/runs", {
      series: FIXTURE_SERIES,
      lessonKey: LESSON,
      edition: "ru-de",
    });
    const odd = {
      id: ulid(),
      type: "answered",
      itemKey: "sprachanker.fixture/demo/00-02/ex-01#1",
      payload: { answer: { text: "x" }, attempt: 1, ms: 1 },
    };
    expect((await send("POST", `/api/runs/${run.id}/events`, { events: [odd] })).status).toBe(400);
    // A step the plan has no kind of is refused.
    const step = { id: ulid(), type: "step_done", payload: { step: "homework" } };
    expect((await send("POST", `/api/runs/${run.id}/events`, { events: [step] })).status).toBe(400);
  });
});

describe("settings and media", () => {
  test("settings round-trip; only the learner's keys, only values that fit", async () => {
    const { send, getJson, root } = await setup();
    await send("PUT", "/api/settings", { key: "uiLanguage", value: "ru" });
    await send("PUT", "/api/settings", { key: `edition:${FIXTURE_SERIES}/demo`, value: "en-de" });
    expect(await getJson("/api/settings")).toEqual({
      uiLanguage: "ru",
      [`edition:${FIXTURE_SERIES}/demo`]: "en-de",
    });
    const status = async (key: string, value: unknown) =>
      (await send("PUT", "/api/settings", { key, value })).status;
    expect(await status("nope", 1)).toBe(400);
    expect(await status("theme", "pink")).toBe(400);
    expect(await status("srs.faces", "x")).toBe(400);
    expect(await status("edition:../x/demo", "ru-de")).toBe(400);
    // The assistant's endpoints and prompts belong to its own routes.
    expect(await status("llm.endpoints", { openrouter: "https://elsewhere.example/v1" })).toBe(400);
    expect(await status("llm.prompts", { tutor: 42 })).toBe(400);
    // A stored value that no longer fits reads as unset.
    new Database(join(root, "profiles/local/profile.sqlite"))
      .query("INSERT INTO settings (key, value_json) VALUES ('theme', '\"pink\"')")
      .run();
    expect(await getJson("/api/settings")).not.toHaveProperty("theme");
    // So does one that is no JSON at all (a damaged row).
    new Database(join(root, "profiles/local/profile.sqlite"))
      .query("INSERT INTO settings (key, value_json) VALUES ('audioRate', '{not json')")
      .run();
    expect(await getJson("/api/settings")).not.toHaveProperty("audioRate");
  });

  test("only this machine's names are answered; security headers", async () => {
    const { app, get } = await setup();
    expect((await app.request("http://rebound.example/api/health")).status).toBe(421);
    for (const host of ["127.0.0.1", "192.168.1.20", "[::1]", "mac.local", "localhost"])
      expect((await app.request(`http://${host}:4580/api/health`)).status).toBe(200);
    // The names given by `serve --allow-host`.
    const allowing = await setup({ allowHosts: ["study.example"] });
    expect((await allowing.app.request("http://study.example/api/health")).status).toBe(200);
    expect((await allowing.app.request("http://other.example/api/health")).status).toBe(421);
    const index = await get("/");
    expect(index.headers.get("x-frame-options")).toBe("DENY");
    expect(index.headers.get("content-security-policy")).toContain("img-src 'self' data: blob:");
  });

  test("media with ranges; nothing outside the media folder", async () => {
    const { get } = await setup();
    const path = `/library/${FIXTURE_SERIES}/media/audio/kaffee.mp3`;
    const full = await get(path);
    expect(full.status).toBe(200);
    const part = await get(path, { headers: { range: "bytes=0-3" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toMatch(/^bytes 0-3\//);
    expect(await part.text()).toBe("spra");
    expect((await get(`/library/${FIXTURE_SERIES}/canonical/demo/course.json`)).status).toBe(404);
    expect(
      (await get(`/library/${FIXTURE_SERIES}/media/../canonical/demo/course.json`)).status,
    ).toBe(404);
  });

  test("media are served by their extension only, as documents that run nothing; a PDF still opens", async () => {
    const { get, root } = await setup();
    const media = join(root, "library", FIXTURE_SERIES, "media");
    await Bun.write(join(media, "audio/evil.html"), "<script>alert(1)</script>");
    await Bun.write(join(media, "image/evil.svg"), "<svg><script>alert(1)</script></svg>");
    await Bun.write(join(media, "pdf/doc.pdf"), "%PDF-1.4");
    for (const name of ["audio/evil.html", "image/evil.svg"]) {
      const res = await get(`/library/${FIXTURE_SERIES}/media/${name}`);
      expect(res.headers.get("content-type")).toBe("application/octet-stream");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("content-security-policy")).toBe(
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      );
    }
    const audio = await get(`/library/${FIXTURE_SERIES}/media/audio/kaffee.mp3`);
    expect(audio.headers.get("content-type")).toBe("audio/mpeg");
    expect(audio.headers.get("content-security-policy")).toContain("sandbox");
    // A PDF: the app's own policy (no sandbox: the browser's viewer would be refused).
    const pdf = await get(`/library/${FIXTURE_SERIES}/media/pdf/doc.pdf`);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(pdf.headers.get("content-security-policy")).not.toContain("sandbox");
  });

  test("a series name cannot point outside the library; malformed escapes are 404", async () => {
    const { get, root } = await setup();
    // "../../" as the series makes <library>/../../media the series' media folder: the folder next
    // to the data root.
    const name = `secret-${Date.now()}.txt`;
    await Bun.write(join(root, "..", "media", name), "secret");
    expect((await get(`/library/..%2F..%2F/media/${name}`)).status).toBe(404);
    expect((await get(`/library/${FIXTURE_SERIES}/media/%E0%A4%A`)).status).toBe(404);
  });
});

test("directory and file assets stay inside their roots", async () => {
  const root = mkdtempSync(join(tmpdir(), "sprachanker-web-"));
  writeFileSync(join(root, "secret.txt"), "secret");
  await Bun.write(join(root, "web/index.html"), "<!doctype html>");
  const dir = directoryAssets(join(root, "web"));
  expect(await (await dir("/index.html"))?.text()).toBe("<!doctype html>");
  expect(await dir("/../secret.txt")).toBeUndefined();
  const listed = fileAssets({ "/index.html": join(root, "web/index.html") });
  expect(await listed("/index-1a2b.html")).toBeUndefined();
});

describe("course check and downloads", () => {
  test("the fixture course checks clean, with counts and media by kind", async () => {
    const { getJson } = await setup();
    const report = await getJson(`/api/course/check?series=${FIXTURE_SERIES}&course=demo`);
    expect(report.problems).toEqual([]);
    expect(report.lessons).toBeGreaterThan(0);
    expect(report.media.byKind.audio.missing).toBe(0);
    expect((await getJson("/api/courses"))[0].source).toBeNull();
  });

  test("downloads: a queue, progress from the importer, the catalogue's states, resume", async () => {
    const offer = (course: string) => ({
      series: "x.demo",
      course,
      edition: "ru-de",
      title: course,
      source: { publisher: "X", url: "https://x.test", licence: "public-domain" as const },
      approxBytes: 1e6,
    });
    const calls: string[] = [];
    const removed: string[] = [];
    const release: Array<() => void> = [];
    const installer: CourseInstaller = {
      async remove(series, course) {
        removed.push(`${series}/${course}`);
        return { files: 3, bytes: 10 };
      },
      offers: () => [offer("one"), offer("two"), offer("three")],
      async run(series, course, { log, progress }) {
        calls.push(`${series}/${course}`);
        progress({ phase: "pages", done: 3 });
        progress({ phase: "media", done: 1, total: 4, bytes: 500 });
        log("media: 1/4");
        await new Promise<void>((resolve) => release.push(resolve));
        return {
          failedMedia: course === "two" ? ["a.mp3: 503"] : [],
          goneMedia: [],
          normalised: {},
        };
      },
      // "three" was left mid-download by an earlier run: it resumes on its own; "two" stopped with an
      // error and waits for the learner.
      unfinished: async () => [
        { series: "x.demo", course: "three" },
        { series: "x.demo", course: "two", error: "host refused" },
      ],
      storage: async () => ({
        dataRoot: "/data",
        series: [{ series: "x.demo", bytes: 42 }],
        free: 1000,
      }),
    };
    const { getJson, send, sendJson } = await setup({ installer });
    await Bun.sleep(1);
    const states = async () =>
      Object.fromEntries(
        ((await getJson("/api/catalog")) as Array<{ course: string; state: string }>).map((e) => [
          e.course,
          e.state,
        ]),
      );
    expect(await states()).toEqual({ one: "available", two: "incomplete", three: "downloading" });
    // Only offered courses can be downloaded.
    expect(
      (await send("POST", "/api/downloads", { series: "x.demo", course: "nope" })).status,
    ).toBe(404);

    const one = await sendJson("POST", "/api/downloads", { series: "x.demo", course: "one" });
    expect(one.status).toBe("queued");
    // Asking again while it waits returns the same job.
    expect((await sendJson("POST", "/api/downloads", { series: "x.demo", course: "one" })).id).toBe(
      one.id,
    );
    const running = (await getJson("/api/downloads")).jobs.find(
      (j: { course: string }) => j.course === "three",
    );
    expect(running.progress).toEqual({
      phase: "media",
      pages: 3,
      media: { done: 1, total: 4, bytes: 500 },
    });
    release.shift()?.();
    await Bun.sleep(1);
    expect(await states()).toMatchObject({ three: "incomplete", one: "downloading" });
    expect(calls).toEqual(["x.demo/three", "x.demo/one"]);
    // Removed from this computer: not while it downloads; one done is.
    const remove = (course: string) =>
      send("DELETE", `/api/course?series=x.demo&course=${course}`, {});
    expect((await remove("one")).status).toBe(409);
    expect(await (await remove("three")).json()).toEqual({ files: 3, bytes: 10 });
    expect(removed).toEqual(["x.demo/three"]);
    expect(await getJson("/api/storage")).toEqual({
      dataRoot: "/data",
      series: [{ series: "x.demo", bytes: 42 }],
      free: 1000,
    });
  });

  test("without an installer nothing can be downloaded", async () => {
    const { send, getJson } = await setup();
    expect(await getJson("/api/catalog")).toEqual([]);
    expect(
      (await send("POST", "/api/downloads", { series: FIXTURE_SERIES, course: "demo" })).status,
    ).toBe(409);
  });
});

test("every API route takes a body of at most 1 MB but those taking a file", async () => {
  const { app, cookie, send } = await setup();
  const big = await send("PUT", "/api/settings", { key: "x", value: "x".repeat(1024 * 1024) });
  expect([big.status, ((await big.json()) as { error: string }).error]).toEqual([
    413,
    "request_too_large",
  ]);
  const recording = await app.request("/api/recordings", {
    method: "POST",
    headers: { cookie, ...CLIENT_HEADERS, "content-type": "audio/webm" },
    body: new Uint8Array(2 * 1024 * 1024),
  });
  expect(recording.status).not.toBe(413);
});
