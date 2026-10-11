import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { studyDay } from "@sprachanker/engine";
import { ulid } from "ulid";
import { deck as deckFile, study, withDecks } from "./deck-setup.ts";
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
  expect(overview.days).toMatchObject([
    {
      start: overview.today,
      lesson: 3,
      exam: 0,
      review: 0,
      ai: 0,
      newCards: 0,
      recalled: 0,
      remembered: 0,
      time: { exam: 0, review: 0, ai: 0 },
    },
  ]);
  // The time between a pass's events (the test's clock moves a second at each reading).
  expect(overview.days[0].time.lesson).toBeGreaterThan(0);
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
    // The course's title in the edition of the runs (ru-de), not its first edition's.
    {
      key: CAFE,
      group: { key: "sprachanker.fixture/demo", title: "Демо-курс" },
      runCount: 2,
      open: true,
    },
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

test("a card answer's time kept (at most a minute; an answer from before it was measured reads without it), the review day in full, lessons and courses done over time", async () => {
  const api = await setup();
  const { sendJson, getJson, send, root } = api;
  await sendJson("POST", "/api/cards/lesson", {
    series: FIXTURE_SERIES,
    lessonKey: CAFE,
    edition: "ru-de",
  });
  const scope = `/api/cards/study?scope=${encodeURIComponent("course:sprachanker.fixture/demo")}`;
  const rate = async (rating: number, ms?: number) => {
    const { current } = await getJson(scope);
    await sendJson("POST", `/api/cards/${current.cardId}/review`, {
      id: ulid(),
      reps: current.reps,
      face: current.face,
      rating,
      ...(ms !== undefined && { ms }),
    });
    return current.cardId as string;
  };
  await rate(3, 4_200);
  // Two minutes on: the card was shown longer than the minute kept.
  api.advance(120_000);
  await rate(1, 3_600_000);
  const untimed = await rate(4);

  const sqlite = new Database(join(root, "profiles/local/profile.sqlite"));
  const stored = sqlite
    .query("SELECT payload_json AS p FROM events WHERE type = 'card_review' ORDER BY ts")
    .all()
    .map((r) => JSON.parse((r as { p: string }).p).ms);
  expect(stored).toEqual([4_200, 60_000, undefined]);

  const overview = await getJson("/api/notebook");
  expect(overview.days[0]).toMatchObject({ review: 3, newCards: 3 });
  expect(overview.days[0].time.review).toBe(64_200);
  // Each span's bars by the server's study days: the last 7 to today; all time within 30 days by day.
  expect(overview.spans.week).toMatchObject({ size: "day" });
  expect(overview.spans.week.starts).toHaveLength(7);
  expect(overview.spans.week.starts.at(-1)).toBe(overview.today);
  expect(overview.spans.all).toEqual(overview.spans.month);
  expect((await api.get("/api/notebook?firstDay=0")).status).toBe(200);
  expect((await api.get("/api/notebook?firstDay=7")).status).toBe(400);
  // The deck's review days: today's, with its three answers, opening in full.
  const deck = moduleOf(overview, "review").entries[0] as Standing["entries"][number] & {
    runs: Array<{ id: string; count: number }>;
  };
  expect(deck.runCount).toBe(1);
  expect(deck.runs.map((r) => r.count)).toEqual([3]);
  const day = await getJson(`/api/notebook/review/${deck.runs[0]?.id}`);
  expect(day.answers.map((a: { rating: number; ms: number | null }) => [a.rating, a.ms])).toEqual([
    [3, 4_200],
    [1, 60_000],
    [4, null],
  ]);
  expect(day.answers[2].cardId).toBe(untimed);
  expect(day.answers[0].card.display.target).toBeTruthy();
  expect(day.answers[0].card.lang).toBe("de");
  // Again on a new card brings it back within minutes; Easy, days later.
  expect(day.answers[1].interval).toBeLessThan(3_600_000);
  expect(day.answers[2].interval).toBeGreaterThan(86_400_000);
  expect(day.day).toEqual({
    answers: 3,
    newCards: 3,
    recalled: 0,
    remembered: null,
    ms: 64_200,
  });
  expect([day.earlier, day.later]).toEqual([null, null]);
  // A run that is no review day is not one.
  expect((await send("GET", `/api/notebook/review/${ulid()}`, undefined)).status).toBe(404);

  // A day later, another review day: the two link to each other.
  api.advance(86_400_000);
  await rate(3, 1_000);
  const next = moduleOf(await getJson("/api/notebook"), "review").entries[0] as typeof deck;
  expect(next.runs.map((r) => r.count)).toEqual([1, 3]);
  const later = await getJson(`/api/notebook/review/${next.runs[0]?.id}`);
  expect([later.earlier, later.later]).toEqual([deck.runs[0]?.id, null]);
  expect((await getJson(`/api/notebook/review/${deck.runs[0]?.id}`)).later).toBe(next.runs[0]?.id);
  // Each dated by the study day it is of, not by when it ended: the next day's first answer ended
  // the first.
  type Run = { id: string; startedAt: number; finishedAt: number; day: number };
  const [today, past] = next.runs as unknown as [Run, Run];
  expect(past.day).toBe(studyDay(past.startedAt).start);
  expect(studyDay(past.finishedAt).start).toBe(today.day);
  expect(past.day).toBeLessThan(today.day);
  expect((await getJson(`/api/notebook/review/${past.id}`)).date).toBe(past.day);
  expect(later.date).toBe(today.day);
  // A review day begun at 2 AM is the day before's (the day starts at 4 AM).
  const t = later.answers[0].ts as number;
  const night = new Date(studyDay(t).next);
  night.setDate(night.getDate() + 1);
  night.setHours(2, 0, 0, 0);
  api.advance(night.getTime() - t);
  await rate(3, 1_000);
  const third = (moduleOf(await getJson("/api/notebook"), "review").entries[0] as typeof deck)
    .runs[0] as unknown as Run;
  expect(new Date(third.startedAt).getHours()).toBe(2);
  expect(third.day).toBe(studyDay(t).next);
  expect((await getJson(`/api/notebook/review/${third.id}`)).date).toBe(third.day);

  // A lesson done: the figure with when, oldest first; no course done yet (the fixture has two lessons).
  const run = (
    await sendJson("POST", "/api/runs", {
      series: FIXTURE_SERIES,
      lessonKey: CAFE,
      edition: "ru-de",
    })
  ).run.id as string;
  const { lesson } = await getJson(
    `/api/lesson?${new URLSearchParams({ series: FIXTURE_SERIES, key: CAFE, edition: "ru-de" })}`,
  );
  const events = [
    ...lesson.pages.flatMap((p: { exercise: { items: Array<{ key: string }> } }) =>
      p.exercise.items.map((item) => ({
        id: ulid(),
        type: "item_skipped",
        itemKey: item.key,
        payload: {},
      })),
    ),
    ...["words", "grammar:0", "culture:0"].map((step) => ({
      id: ulid(),
      type: "step_done",
      payload: { step },
    })),
  ];
  await sendJson("POST", `/api/runs/${run}/events`, { events });
  const finished = await sendJson("POST", `/api/runs/${run}/finish`, {});
  const lessons = moduleOf(await getJson("/api/notebook"), "lesson").figures as Array<{
    id: string;
    value: number;
    at: number[];
  }>;
  expect(lessons.find((f) => f.id === "lessonsDone")).toMatchObject({
    value: 1,
    at: [finished.finishedAt],
  });
  expect(lessons.find((f) => f.id === "coursesDone")).toMatchObject({ value: 0, at: [] });
});

test("a deck's review day: only its language's answers, what they held and the days its cards were answered on", async () => {
  const api = await withDecks();
  const { sendJson, getJson, preview } = api;
  await sendJson("POST", "/api/cards/lesson", {
    series: FIXTURE_SERIES,
    lessonKey: CAFE,
    edition: "ru-de",
  });
  // A deck of another language beside the course's German words.
  const { upload } = await preview(deckFile());
  const french = await sendJson("POST", "/api/decks/import", {
    upload,
    title: "Mon paquet",
    lang: "fr",
    translationLang: "en",
    file: "fr.apkg",
  });
  await sendJson("POST", "/api/cards/decks/take", { deck: french.id });
  const rate = async (lang: string) => {
    const { current } = await getJson(study(`lang:${lang}`));
    await sendJson("POST", `/api/cards/${current.cardId}/review`, {
      id: ulid(),
      reps: current.reps,
      face: current.face,
      rating: 3,
      ms: 2_000,
    });
  };
  await rate("de");
  await rate("fr");
  await rate("de");
  api.advance(86_400_000);
  await rate("de");

  const decks = moduleOf(await getJson("/api/notebook"), "review").entries as unknown as Array<{
    key: string;
    runs: Array<{ id: string; count: number }>;
  }>;
  const de = decks.find((d) => d.key === "de");
  const fr = decks.find((d) => d.key === "fr");
  expect(de?.runs.map((r) => r.count)).toEqual([1, 2]);
  expect(fr?.runs.map((r) => r.count)).toEqual([1]);
  const first = fr?.runs[0]?.id as string;
  expect(de?.runs[1]?.id).toBe(first);

  // The first day as French's: its one answer, what it held, no day after (French was not studied).
  const french1 = await getJson(`/api/notebook/review/${first}?lang=fr`);
  expect(french1.answers.map((a: { card: { lang: string } }) => a.card.lang)).toEqual(["fr"]);
  expect(french1.day).toMatchObject({ answers: 1, newCards: 1 });
  expect([french1.earlier, french1.later]).toEqual([null, null]);
  // As German's: its two answers, the next day after it.
  const german1 = await getJson(`/api/notebook/review/${first}?lang=de`);
  expect(german1.answers.map((a: { card: { lang: string } }) => a.card.lang)).toEqual(["de", "de"]);
  expect(german1.day).toMatchObject({ answers: 2, newCards: 2 });
  expect([german1.earlier, german1.later]).toEqual([null, de?.runs[0]?.id]);
  // Every language's without one.
  expect((await getJson(`/api/notebook/review/${first}`)).answers).toHaveLength(3);
  expect((await api.get(`/api/notebook/review/${first}?lang=x`)).status).toBe(400);
});
