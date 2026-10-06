import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { ulid } from "ulid";
import { directoryAssets, fileAssets } from "../src/runtime/bun.ts";
import { setup } from "./setup.ts";

const COURSE = { series: FIXTURE_SERIES, course: "demo", edition: "ru-de" };
const LESSON = "sprachanker.fixture/demo/00-01";

describe("web app", () => {
  test("health, index, hashed assets, client routes, unknown api", async () => {
    const { get, getJson } = await setup();
    expect(await getJson("/api/health")).toEqual({ status: "ok" });
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
      },
    ]);
    const map = await getJson(`/api/course?${new URLSearchParams(COURSE)}`);
    expect(map.titles[LESSON]).toBe("Im Café");
    expect(map.progress).toEqual({});
    const { lesson, locale } = await getJson(
      `/api/lesson?${new URLSearchParams({ series: FIXTURE_SERIES, key: LESSON, edition: "en-de" })}`,
    );
    expect(lesson.key).toBe(LESSON);
    expect(locale.edition).toBe("en-de");
  });

  test("bad queries are rejected", async () => {
    const { get } = await setup();
    expect((await get(`/api/lesson?series=x&key=nope&edition=ru-de`)).status).toBe(400);
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
    const { getJson, sendJson } = await setup();
    const q = new URLSearchParams({ series: FIXTURE_SERIES, lessonKey: LESSON, edition: "ru-de" });
    expect((await getJson(`/api/runs/lesson?${q}`)).state).toBeNull();
    expect((await getJson("/api/courses"))[0].nextStarted).toBe(false);

    const body = { series: FIXTURE_SERIES, lessonKey: LESSON, edition: "ru-de" };
    const { run } = await sendJson("POST", "/api/runs", body);
    const skipped = { id: ulid(), type: "item_skipped", itemKey: `${LESSON}/ex-01#2`, payload: {} };
    await sendJson("POST", `/api/runs/${run.id}/events`, { events: [skipped] });
    const active = (await getJson(`/api/runs/lesson?${q}`)).state;
    expect([active.run.id, active.run.status, active.events[0].type]).toEqual([
      run.id,
      "active",
      "item_skipped",
    ]);

    await sendJson("POST", `/api/runs/${run.id}/finish`, {});
    const done = (await getJson(`/api/runs/lesson?${q}`)).state;
    expect([done.run.id, done.run.status]).toEqual([run.id, "finished"]);
    // Skipped items are not answers: they count neither for the score nor as answered.
    expect(done.run.result).toEqual({ score: 0, scored: 0, answered: 0 });

    const again = await sendJson("POST", "/api/runs", { ...body, restart: true });
    expect(again.run.id).not.toBe(run.id);
    expect(again.events).toEqual([]);
    expect((await getJson(`/api/runs/lesson?${q}`)).state.run.id).toBe(again.run.id);
  });

  test("start, answer (outcomes by the server, idempotent), resume, finish, progress", async () => {
    const { send, getJson, sendJson } = await setup();
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

    const again = await sendJson("POST", `/api/runs/${runId}/events`, {
      events: [right, { id: ulid(), type: "page_shown", payload: { pageIndex: 2 } }],
    });
    expect(again.outcomes).toEqual({});

    const resumed = await sendJson("POST", "/api/runs", {
      series: FIXTURE_SERIES,
      lessonKey: LESSON,
      edition: "ru-de",
    });
    expect(resumed.run.id).toBe(runId);
    expect(resumed.resumePage).toBe(2);
    expect(resumed.events).toHaveLength(5);
    expect(resumed.events[0].payload.snapshot.exercise.key).toBe(`${LESSON}/ex-01`);

    const finished = await sendJson("POST", `/api/runs/${runId}/finish`, {});
    expect(finished.status).toBe("finished");
    expect(finished.result).toEqual({ score: 0.5, scored: 2, answered: 2 });
    const map = await getJson(`/api/course?${new URLSearchParams(COURSE)}`);
    expect(map.progress[LESSON]).toEqual({ status: "done", bestScore: 0.5, finishedRuns: 1 });
    expect((await send("POST", `/api/runs/${runId}/events`, { events: [] })).status).toBe(409);
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
  });
});

describe("settings and media", () => {
  test("settings round-trip", async () => {
    const { send, getJson } = await setup();
    await send("PUT", "/api/settings", { key: "uiLanguage", value: "ru" });
    expect(await getJson("/api/settings")).toEqual({ uiLanguage: "ru" });
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
