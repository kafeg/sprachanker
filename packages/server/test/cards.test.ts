import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { openLibrary } from "@sprachanker/course-kit";
import { ulid } from "ulid";
import { createCardStore } from "../src/services/card-store.ts";
import { createCards } from "../src/services/cards.ts";
import { createContent } from "../src/services/content.ts";
import { createSettings } from "../src/services/settings.ts";
import { setup } from "./setup.ts";

const COURSE = "sprachanker.fixture/demo";
const LESSONS = [`${COURSE}/00-01`, `${COURSE}/00-02`];
const study = (scope: string) => `/api/cards/study?scope=${encodeURIComponent(scope)}`;

async function withCards() {
  const api = await setup();
  for (const lessonKey of LESSONS)
    await api.sendJson("POST", "/api/cards/lesson", {
      series: FIXTURE_SERIES,
      lessonKey,
      edition: "ru-de",
    });
  return api;
}

test("a lesson's words become cards, one per word, kept when met again; decks by language and course", async () => {
  const { sendJson, getJson } = await setup();
  const make = () =>
    sendJson("POST", "/api/cards/lesson", {
      series: FIXTURE_SERIES,
      lessonKey: LESSONS[0],
      edition: "ru-de",
    });
  expect((await make()).created).toBe(4);
  expect((await make()).created).toBe(0);
  const { decks } = await getJson("/api/cards/decks");
  // Four words, two faces each: eight new cards (within the day's 20).
  expect(decks).toEqual([
    {
      scope: "lang:de",
      language: "de",
      counts: { new: 8, learning: 0, review: 0 },
      courses: [
        { scope: `course:${COURSE}`, course: COURSE, counts: { new: 8, learning: 0, review: 0 } },
      ],
    },
  ]);
  const kaffee = (await getJson("/api/cards")).words.find(
    (w: { lexemeKey: string }) => w.lexemeKey === "lex:de:kaffee:noun:m",
  );
  expect(kaffee.display).toMatchObject({
    target: "der Kaffee, die Kaffees",
    gender: "m",
    translation: "кофе",
  });
});

test("study as in Anki: card 1 of every note first; a rating moves it to learning; undo takes it back", async () => {
  const { sendJson, getJson, send, root } = await withCards();
  const first = await getJson(study(`course:${COURSE}`));
  expect(first.counts).toEqual({ new: 12, learning: 0, review: 0 });
  expect(first.current).toMatchObject({ face: "recognition", kind: "new", flag: 0, marked: false });
  expect(first.current.display.target).toBe("der Kaffee, die Kaffees");
  expect(first.canUndo).toBe(false);
  // Again 1m, Hard 6m, Good 10m (the learning steps), Easy days later.
  const now = first.current.due[1] - 60_000;
  expect([first.current.due[2] - now, first.current.due[3] - now]).toEqual([
    6 * 60_000,
    10 * 60_000,
  ]);

  await sendJson("POST", `/api/cards/${first.current.cardId}/review`, {
    id: ulid(),
    reps: 0,
    face: "recognition",
    rating: 3,
  });
  const after = await getJson(study(`course:${COURSE}`));
  expect(after.counts).toEqual({ new: 11, learning: 1, review: 0 });
  expect(after.current.cardId).not.toBe(first.current.cardId);
  expect(after.canUndo).toBe(true);

  expect(await sendJson("POST", "/api/cards/undo", {})).toEqual({
    cardId: first.current.cardId,
    face: "recognition",
  });
  expect((await getJson(study(`course:${COURSE}`))).counts).toEqual({
    new: 12,
    learning: 0,
    review: 0,
  });
  // The review stays in the log, taken back by a card_undo event.
  const sqlite = new Database(join(root, "profiles/local/profile.sqlite"));
  expect(sqlite.query("SELECT type FROM events ORDER BY ts").all()).toEqual([
    { type: "card_review" },
    { type: "card_undo" },
  ]);
  expect((await send("POST", "/api/cards/undo", {})).status).toBe(409);

  expect((await getJson(study(`course:${COURSE}`))).canUndo).toBe(false);

  // A rating sent twice is applied once; a face rated meanwhile elsewhere is refused.
  const answer = { id: ulid(), face: "recognition", rating: 3, reps: 0 };
  const path = `/api/cards/${first.current.cardId}/review`;
  const once = await sendJson("POST", path, answer);
  expect(await sendJson("POST", path, answer)).toEqual(once);
  expect(sqlite.query("SELECT type FROM events WHERE type = 'card_review'").all()).toHaveLength(2);
  const stale = await send("POST", path, { ...answer, id: ulid() });
  expect([stale.status, ((await stale.json()) as { error: string }).error]).toEqual([
    409,
    "card_changed",
  ]);
});

test("undo shows the face taken back next, ahead of the queue's order, until something is answered", async () => {
  const { sendJson, getJson } = await withCards();
  const scope = study(`course:${COURSE}`);
  const order = await getJson(scope);
  // A card further down the queue, answered out of turn.
  const later = (await getJson("/api/cards")).words.find(
    (w: { cardId: string }) => w.cardId !== order.current.cardId,
  );
  await sendJson("POST", `/api/cards/${later.cardId}/review`, {
    id: ulid(),
    reps: 0,
    face: "production",
    rating: 3,
  });
  await sendJson("POST", "/api/cards/undo", {});
  expect((await getJson(scope)).current).toMatchObject({
    cardId: later.cardId,
    face: "production",
  });
  // Answering anything returns the queue to its order.
  await sendJson("POST", `/api/cards/${later.cardId}/review`, {
    id: ulid(),
    reps: 0,
    face: "production",
    rating: 3,
  });
  expect((await getJson(scope)).current.cardId).toBe(order.current.cardId);
});

test("limits: a lesson's own words ignore the new limit; the review limit holds new cards too", async () => {
  const { send, getJson } = await withCards();
  await send("PUT", "/api/settings", { key: "srs.newPerDay", value: 1 });
  expect((await getJson(study(`course:${COURSE}`))).counts.new).toBe(1);
  // The lesson's words: their first card type, all of them.
  const lesson = await getJson(study(`lesson:ru-de:${LESSONS[0]}`));
  expect(lesson.counts).toEqual({ new: 4, learning: 0, review: 0 });
  expect(lesson.current.face).toBe("recognition");
  await send("PUT", "/api/settings", { key: "srs.reviewsPerDay", value: 0 });
  const held = await getJson(study(`course:${COURSE}`));
  expect([held.counts.new, held.current, held.newWaiting]).toEqual([0, null, true]);
});

test("a lesson's words as in Anki: Good and Again both keep a new word learning, shown again in the step", async () => {
  const { sendJson, getJson } = await withCards();
  const scope = study(`lesson:ru-de:${LESSONS[0]}`);
  const rate = async (rating: number) => {
    const { current } = await getJson(scope);
    await sendJson("POST", `/api/cards/${current.cardId}/review`, {
      id: ulid(),
      reps: 0,
      face: current.face,
      rating,
    });
  };
  await rate(3);
  await rate(1);
  const lesson = await getJson(scope);
  // Again's 1 minute and Good's 10 are within Anki's 20-minute learn-ahead: both count as learning.
  expect(lesson.counts).toEqual({ new: 2, learning: 2, review: 0 });
  expect((await getJson(study(`course:${COURSE}`))).counts.learning).toBe(2);
});

test("each deck has its own day: German answers do not use up English's new cards", async () => {
  const { send, sendJson, getJson, root } = await withCards();
  // An English word next to the German ones (its course is the lesson's; its language its own).
  const sqlite = new Database(join(root, "profiles/local/profile.sqlite"));
  sqlite
    .query(
      "INSERT INTO cards (id, kind, lexeme_key, faces, display_cache_json, created_at) VALUES (?, 'lexeme', ?, 'recognition', ?, 1)",
    )
    .run(
      "01HZZZZZZZZZZZZZZZZZZZZZZY",
      "lex:en:coffee:noun",
      JSON.stringify({ target: "coffee", series: FIXTURE_SERIES, lessonKey: LESSONS[0] }),
    );
  await send("PUT", "/api/settings", { key: "srs.newPerDay", value: 1 });
  const german = (await getJson(study("lang:de"))).current;
  await sendJson("POST", `/api/cards/${german.cardId}/review`, {
    id: ulid(),
    reps: 0,
    face: german.face,
    rating: 3,
  });
  expect((await getJson(study("lang:de"))).counts.new).toBe(0);
  expect((await getJson(study("lang:en"))).counts.new).toBe(1);
});

test("bury, suspend, flag and mark as in Anki's reviewer", async () => {
  const { sendJson, send, getJson } = await withCards();
  const card = (await getJson(study(`course:${COURSE}`))).current;
  const ids = async () => {
    const s = await getJson(study(`lesson:ru-de:${LESSONS[0]}`));
    return { count: s.counts.new, buried: s.buried };
  };
  await sendJson("POST", `/api/cards/${card.cardId}/bury`, {});
  // The note's faces are buried; a lesson's words show their first card type, so one of them here.
  expect(await ids()).toEqual({ count: 3, buried: 1 });
  // Unbury is a deck's: another deck's leaves this one buried.
  await sendJson("POST", "/api/cards/unbury", { scope: "lang:en" });
  expect(await ids()).toEqual({ count: 3, buried: 1 });
  await sendJson("POST", "/api/cards/unbury", { scope: `lesson:ru-de:${LESSONS[0]}` });
  expect(await ids()).toEqual({ count: 4, buried: 0 });

  await sendJson("PUT", `/api/cards/${card.cardId}/suspend`, {
    suspended: true,
    face: "recognition",
  });
  expect((await ids()).count).toBe(3);
  await sendJson("PUT", `/api/cards/${card.cardId}/suspend`, {
    suspended: false,
    face: "recognition",
  });
  await sendJson("PUT", `/api/cards/${card.cardId}/suspend`, { suspended: true });
  expect((await ids()).count).toBe(3);
  await sendJson("PUT", `/api/cards/${card.cardId}/suspend`, { suspended: false });

  await sendJson("PUT", `/api/cards/${card.cardId}/flag`, { face: "recognition", flag: 2 });
  await sendJson("PUT", `/api/cards/${card.cardId}/mark`, { marked: true });
  expect((await getJson(study(`lesson:ru-de:${LESSONS[0]}`))).current).toMatchObject({
    flag: 2,
    marked: true,
  });

  const missing = "01HZZZZZZZZZZZZZZZZZZZZZZZ";
  expect((await send("PUT", `/api/cards/${missing}/mark`, { marked: true })).status).toBe(404);
  expect(
    (
      await send("POST", `/api/cards/${card.cardId}/review`, {
        id: ulid(),
        reps: 0,
        face: "listening",
        rating: 3,
      })
    ).status,
  ).toBe(404);
  expect((await send("GET", study("course:nope"), undefined)).status).toBe(400);
});

test("a word learned in another language is another card: each edition studies its own translations", async () => {
  const { sendJson, getJson, root, profile } = await withCards();
  const make = (edition: string) =>
    sendJson("POST", "/api/cards/lesson", {
      series: FIXTURE_SERIES,
      lessonKey: LESSONS[0],
      edition,
    });
  // The Russian edition made the lesson's four cards; the English one makes its own four.
  expect((await make("en-de")).created).toBe(4);
  const inLesson = async (edition: string) => {
    const s = await getJson(study(`lesson:${edition}:${LESSONS[0]}`));
    return [s.counts.new, s.current.display.translation];
  };
  expect(await inLesson("ru-de")).toEqual([4, "кофе"]);
  expect(await inLesson("en-de")).toEqual([4, "coffee"]);
  // A card from before its language was kept gets the one its translation came from.
  const sqlite = new Database(join(root, "profiles/local/profile.sqlite"));
  sqlite.exec("DELETE FROM cards WHERE translation_lang = 'en'");
  sqlite.exec("UPDATE cards SET translation_lang = NULL");
  const cards = createCards({
    cards: createCardStore(profile),
    content: createContent(openLibrary(join(root, "library"))),
    settings: createSettings(profile),
    session: async () => undefined,
    now: Date.now,
  });
  await cards.relink();
  expect(sqlite.query("SELECT DISTINCT translation_lang AS lang FROM cards").all()).toEqual([
    { lang: "ru" },
  ]);
});

test("a card follows its word's lexeme when a course is normalised again; no second card", async () => {
  const { sendJson, getJson, root, profile } = await withCards();
  const sqlite = new Database(join(root, "profiles/local/profile.sqlite"));
  const kaffee = "lex:de:kaffee:noun:m";
  // As if made by an earlier rule.
  sqlite
    .query("UPDATE cards SET lexeme_key = 'lex:de:kaffee:word' WHERE lexeme_key = ?")
    .run(kaffee);
  const count = () => (sqlite.query("SELECT count(*) AS n FROM cards").get() as { n: number }).n;
  const before = count();
  const cards = createCards({
    cards: createCardStore(profile),
    content: createContent(openLibrary(join(root, "library"))),
    settings: createSettings(profile),
    session: async () => undefined,
    now: Date.now,
  });
  expect(await cards.relink()).toBe(1);
  expect(await cards.relink()).toBe(0);
  const words = (await getJson("/api/cards")).words.map((w: { lexemeKey: string }) => w.lexemeKey);
  expect(words).toContain(kaffee);
  // The same through making the lesson's cards again.
  sqlite
    .query("UPDATE cards SET lexeme_key = 'lex:de:kaffee:word' WHERE lexeme_key = ?")
    .run(kaffee);
  await sendJson("POST", "/api/cards/lesson", {
    series: FIXTURE_SERIES,
    lessonKey: LESSONS[0],
    edition: "ru-de",
  });
  expect(count()).toBe(before);
  expect(sqlite.query("SELECT 1 FROM cards WHERE lexeme_key = ?").get(kaffee)).toBeTruthy();
});

test("My words: a word's sheet has each face's state and its answers; an undone answer is left out", async () => {
  const { send, sendJson, getJson } = await withCards();
  const word = (await getJson("/api/cards")).words.find(
    (w: { lexemeKey: string }) => w.lexemeKey === "lex:de:kaffee:noun:m",
  );
  expect([word.lang, word.course, word.state, word.due]).toEqual(["de", COURSE, "new", null]);
  const rate = (face: string, rating: number, reps: number) =>
    sendJson("POST", `/api/cards/${word.cardId}/review`, { id: ulid(), face, rating, reps });
  await rate("recognition", 1, 0);
  await rate("recognition", 3, 1);
  await rate("production", 3, 0);
  await sendJson("POST", "/api/cards/undo", {});
  const sheet = await getJson(`/api/cards/${word.cardId}`);
  expect(sheet.state).toBe("learning");
  expect(sheet.faces.map((f: { face: string; stage: string }) => [f.face, f.stage])).toEqual([
    ["recognition", "learning"],
    ["production", "new"],
  ]);
  // Newest first; the production answer was taken back.
  expect(sheet.answers.map((a: { face: string; rating: number }) => [a.face, a.rating])).toEqual([
    ["recognition", 3],
    ["recognition", 1],
  ]);
  expect(sheet.due).toBe(sheet.faces[0].due);
  // A suspended word is not due; a word that is not there is a 404.
  await send("PUT", `/api/cards/${word.cardId}/suspend`, { suspended: true });
  const suspended = await getJson(`/api/cards/${word.cardId}`);
  expect([suspended.suspended, suspended.due]).toEqual([true, null]);
  expect((await send("GET", `/api/cards/${ulid()}`, undefined)).status).toBe(404);
});

test("cards remember the run they were made in; resetting the lesson leaves them, without it", async () => {
  const { sendJson, root } = await setup();
  const lessonKey = LESSONS[0];
  const run = (
    await sendJson("POST", "/api/runs", { series: FIXTURE_SERIES, lessonKey, edition: "ru-de" })
  ).run.id;
  await sendJson("POST", "/api/cards/lesson", {
    series: FIXTURE_SERIES,
    lessonKey,
    edition: "ru-de",
  });
  const sqlite = new Database(join(root, "profiles/local/profile.sqlite"));
  const origins = () =>
    sqlite
      .query<{ origin_run_id: string | null }, []>("SELECT origin_run_id FROM cards")
      .all()
      .map((r) => r.origin_run_id);
  expect(origins()).toEqual([run, run, run, run]);
  await sendJson("POST", "/api/progress/reset", {
    series: FIXTURE_SERIES,
    course: "demo",
    lesson: lessonKey,
  });
  expect(origins()).toEqual([null, null, null, null]);
});
