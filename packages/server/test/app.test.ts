import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { runs } from "../src/db/profile/schema.ts";
import { directoryAssets, fileAssets } from "../src/runtime/bun.ts";
import type { CourseInstaller } from "../src/services/downloads.ts";
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
        nextTitle: "Im Café",
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
    const api = await setup();
    const { getJson, sendJson, send } = api;
    const q = new URLSearchParams({ series: FIXTURE_SERIES, lessonKey: LESSON });
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

    // A run with exercises left is not complete.
    expect((await send("POST", `/api/runs/${run.id}/finish`, {})).status).toBe(409);
    await skipRest(api, run.id);
    await sendJson("POST", `/api/runs/${run.id}/finish`, {});
    const done = (await getJson(`/api/runs/lesson?${q}`)).state;
    expect([done.run.id, done.run.status]).toEqual([run.id, "finished"]);
    // Skipped items are not answers; skipped checked items count as wrong (9 of them in the fixture).
    expect(done.run.result).toEqual({ score: 0, scored: 9, answered: 0 });

    const again = await sendJson("POST", "/api/runs", { ...body, restart: true });
    expect(again.run.id).not.toBe(run.id);
    expect(again.events).toEqual([]);
    expect((await getJson(`/api/runs/lesson?${q}`)).state.run.id).toBe(again.run.id);
    const first = { id: ulid(), type: "item_skipped", itemKey: `${LESSON}/ex-01#1`, payload: {} };
    await sendJson("POST", `/api/runs/${again.run.id}/events`, { events: [first] });
    expect((await getJson(`/api/runs/lesson?${q}`)).state.run.id).toBe(again.run.id);
    const map = await getJson(`/api/course?${new URLSearchParams(COURSE)}`);
    expect(map.lessons[LESSON]).toMatchObject({ done: true, run: { status: "active", worked: 1 } });
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

    await skipRest(api, runId, [`${LESSON}/ex-01`]);
    const finished = await sendJson("POST", `/api/runs/${runId}/finish`, {});
    expect(finished.status).toBe("finished");
    // One of two answered right; the 7 checked items skipped count 0.
    expect(finished.result).toEqual({ score: 1 / 9, scored: 9, answered: 2 });
    const map = await getJson(`/api/course?${new URLSearchParams(COURSE)}`);
    const total = map.lessons[LESSON].run.total;
    expect(map.lessons[LESSON]).toEqual({
      done: true,
      run: { status: "finished", worked: total, total, score: 1 / 9 },
    });
    expect((await send("POST", `/api/runs/${runId}/events`, { events: [] })).status).toBe(409);
  });

  test("a run finished with exercises left (before completion was enforced) does not count", async () => {
    const { profile, getJson, sendJson } = await setup();
    const body = { series: FIXTURE_SERIES, lessonKey: LESSON, edition: "ru-de" };
    const { run } = await sendJson("POST", "/api/runs", body);
    const skipped = { id: ulid(), type: "item_skipped", itemKey: `${LESSON}/ex-01#1`, payload: {} };
    await sendJson("POST", `/api/runs/${run.id}/events`, { events: [skipped] });
    // As the old player stored it: finished on opening the summary, with most exercises untouched.
    profile
      .update(runs)
      .set({
        status: "finished",
        endReason: "completed",
        resultJson: '{"score":0,"scored":0,"answered":0}',
      })
      .where(eq(runs.id, run.id))
      .run();
    const q = new URLSearchParams({ series: FIXTURE_SERIES, lessonKey: LESSON });
    expect((await getJson(`/api/runs/lesson?${q}`)).state).toBeNull();
    const map = await getJson(`/api/course?${new URLSearchParams(COURSE)}`);
    expect(map.lessons[LESSON]).toBeUndefined();
    expect((await getJson("/api/courses"))[0].done).toBe(0);
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
    });
    expect(await map()).toEqual([SECOND]);
    // A lesson of another course is refused.
    const other = { series: FIXTURE_SERIES, course: "other", lesson: SECOND };
    expect((await send("POST", "/api/progress/reset", other)).status).toBe(400);

    expect(await sendJson("POST", "/api/progress/reset", course)).toEqual({ runs: 1, events: 1 });
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
    const release: Array<() => void> = [];
    const installer: CourseInstaller = {
      offers: () => [offer("one"), offer("two"), offer("three")],
      async run(series, course, { log, progress }) {
        calls.push(`${series}/${course}`);
        progress({ phase: "pages", done: 3 });
        progress({ phase: "media", done: 1, total: 4, bytes: 500 });
        log("media: 1/4");
        await new Promise<void>((resolve) => release.push(resolve));
        return { failedMedia: course === "two" ? ["a.mp3: 404"] : [], normalised: {} };
      },
      // "three" was left mid-download by an earlier run: it resumes on its own; "two" stopped with an
      // error and waits for the learner.
      unfinished: async () => [
        { series: "x.demo", course: "three" },
        { series: "x.demo", course: "two", error: "host refused" },
      ],
      storage: async () => ({ dataRoot: "/data", series: [{ series: "x.demo", bytes: 42 }] }),
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
    expect(await getJson("/api/storage")).toEqual({
      dataRoot: "/data",
      series: [{ series: "x.demo", bytes: 42 }],
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
