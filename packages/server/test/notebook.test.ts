import { expect, test } from "bun:test";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { ulid } from "ulid";
import { setup } from "./setup.ts";

const CAFE = "sprachanker.fixture/demo/00-01";
const ITEM = `${CAFE}/ex-01#1`;

interface Standing {
  module: string;
  figures: Array<{ id: string; value: number | null; count?: number }>;
  entries: Array<Record<string, unknown> & { figures: Standing["figures"] }>;
}
/** A module's standing in the overview, and one of its figures. */
const moduleOf = (overview: { modules: Standing[] }, module: string) =>
  overview.modules.find((m) => m.module === module) as Standing;
const figure = (figures: Standing["figures"], id: string) => figures.find((f) => f.id === id);

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

  // An empty Notebook: no study days, nothing known, nothing worked on yet.
  const empty = await getJson("/api/notebook");
  expect(empty.days).toEqual([]);
  expect(empty.modules.map((m: Standing) => m.module)).toEqual(["review", "lesson", "exam"]);
  expect(figure(moduleOf(empty, "review").figures, "wordsKnown")?.value).toBe(0);
  expect(figure(moduleOf(empty, "lesson").figures, "lessonsDone")?.value).toBe(0);
  expect(moduleOf(empty, "lesson").entries).toEqual([]);
  expect(empty.today).toBeLessThanOrEqual(Date.now());

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
  // Today: three lesson answers; the words added are new cards, none known yet.
  expect(overview.days).toEqual([
    {
      start: overview.today,
      lesson: 3,
      exam: 0,
      review: 0,
      ai: 0,
      newCards: 0,
      recalled: 0,
      remembered: 0,
    },
  ]);
  expect(figure(moduleOf(overview, "lesson").figures, "lessonsDone")?.value).toBe(0);

  // Two cards answered and one answer taken back: one review, one new card learnt.
  const scope = `/api/cards/study?scope=${encodeURIComponent("course:sprachanker.fixture/demo")}`;
  for (let i = 0; i < 2; i++) {
    const { current } = await getJson(scope);
    await sendJson("POST", `/api/cards/${current.cardId}/review`, {
      id: ulid(),
      reps: 0,
      face: current.face,
      rating: 3,
    });
  }
  await sendJson("POST", "/api/cards/undo", { scope: "course:sprachanker.fixture/demo" });
  const after = await getJson("/api/notebook");
  expect(after.days[0]).toMatchObject({ review: 1, newCards: 1 });
  // The German deck: one word learning, the rest new; the answer kept is the month's.
  const decks = moduleOf(after, "review").entries;
  expect(decks).toHaveLength(1);
  const deck = decks[0] as Standing["entries"][number];
  expect(deck.key).toBe("de");
  expect(figure(deck.figures, "remembered")?.count).toBe(1);
  expect(figure(deck.figures, "learning")?.value).toBe(1);
  expect(figure(deck.figures, "new")?.value).toBeGreaterThan(0);
  expect(figure(deck.figures, "dueToday")?.value).toBeGreaterThanOrEqual(1);
  const lessons = moduleOf(overview, "lesson").entries;
  expect(lessons).toMatchObject([
    { key: CAFE, group: { key: "sprachanker.fixture/demo" }, runCount: 2, open: true },
  ]);
  expect(figure(lessons[0]?.figures ?? [], "best")?.value).toBeNull();
  expect(lessons[0]?.title).toBeTruthy();

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
