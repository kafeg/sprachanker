import { expect, test } from "bun:test";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { ulid } from "ulid";
import { setup } from "./setup.ts";

const CAFE = "sprachanker.fixture/demo/00-01";
const ITEM = `${CAFE}/ex-01#1`;

test("the Notebook: study days, lessons with their passes, a pass in full, an item across passes", async () => {
  const { sendJson, getJson, send } = await setup();
  const start = async (restart = false) =>
    (
      await sendJson("POST", "/api/runs", {
        series: FIXTURE_SERIES,
        lessonKey: CAFE,
        edition: "ru-de",
        restart,
      })
    ).run.id as string;
  const record = (runId: string, events: unknown[]) =>
    sendJson("POST", `/api/runs/${runId}/events`, { events });
  const answer = (runId: string, optionId: string, attempt: number) =>
    record(runId, [
      {
        id: ulid(),
        type: "answered",
        itemKey: ITEM,
        payload: { answer: { optionId }, attempt, ms: 1 },
      },
    ]);

  // An empty Notebook: the days are there, nothing worked on yet.
  const empty = await getJson("/api/notebook");
  expect(empty.days).toHaveLength(14);
  expect(empty.courses).toEqual([]);

  // A lesson opened and started over without any work is no pass.
  await start();
  const first = await start(true);
  await record(first, [{ id: ulid(), type: "page_shown", payload: { pageIndex: 0 } }]);
  await answer(first, "b", 1);
  await answer(first, "a", 2);
  await sendJson("POST", "/api/cards/lesson", {
    series: FIXTURE_SERIES,
    lessonKey: CAFE,
    edition: "ru-de",
  });
  const second = await start(true);
  await answer(second, "a", 1);

  const overview = await getJson("/api/notebook");
  expect(overview.days.at(-1).count).toBe(3);
  expect(overview.courses).toMatchObject([
    {
      key: "sprachanker.fixture/demo",
      lessons: [{ key: CAFE, passes: 2, best: null, open: true }],
    },
  ]);
  expect(overview.courses[0].lessons[0].title).toBeTruthy();

  const lesson = await getJson(`/api/notebook/lesson?lessonKey=${CAFE}`);
  expect(lesson.passes.map((p: { id: string }) => p.id)).toEqual([second, first]);
  expect(lesson.passes[1]).toMatchObject({ status: "abandoned", worked: 1, words: 4 });
  expect(lesson.passes[1].total).toBeGreaterThan(1);

  const pass = await getJson(`/api/notebook/passes/${first}`);
  expect(pass.run.id).toBe(first);
  expect(pass.events.map((e: { type: string }) => e.type)).toEqual([
    "page_shown",
    "answered",
    "answered",
  ]);
  // The page as it was shown is kept with the pass.
  expect(pass.events[0].payload.snapshot.exercise.key).toBe(`${CAFE}/ex-01`);
  expect(pass.lesson.key).toBe(CAFE);
  expect(pass.words.map((w: { target: string }) => w.target)).toContain("der Kaffee, die Kaffees");
  expect([pass.explanations, pass.writing, pass.chats, pass.scenes]).toEqual([[], [], [], []]);

  const item = await getJson(`/api/notebook/item?itemKey=${encodeURIComponent(ITEM)}`);
  expect(
    item.passes.map((p: { runId: string; answers: Array<{ attempt: number }> }) => [
      p.runId,
      p.answers.map((a) => a.attempt),
    ]),
  ).toEqual([
    [second, [1]],
    [first, [1, 2]],
  ]);
  expect(item.passes[1].answers[0].outcome.result).toBe("wrong");

  expect((await send("GET", `/api/notebook/passes/${ulid()}`, undefined)).status).toBe(404);
});
