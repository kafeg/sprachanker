import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { openLibrary } from "@sprachanker/course-kit";
import { ulid } from "ulid";
import { createCardStore } from "../src/services/card-store.ts";
import { createCards } from "../src/services/cards.ts";
import { createContent } from "../src/services/content.ts";
import { createRunStore } from "../src/services/run-store.ts";
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
      decks: [
        {
          scope: `course:${COURSE}`,
          // The course's title in the deck's edition, not its first.
          title: "Демо-курс",
          editions: ["ru-de"],
          counts: { new: 8, learning: 0, review: 0 },
        },
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

  expect(await sendJson("POST", "/api/cards/undo", { scope: `course:${COURSE}` })).toEqual({
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
  expect((await send("POST", "/api/cards/undo", { scope: `course:${COURSE}` })).status).toBe(409);

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
  await sendJson("POST", "/api/cards/undo", { scope: `course:${COURSE}` });
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

test("cards without recognition (the learner's choice): a lesson's words are studied by their first face", async () => {
  const api = await setup();
  await api.send("PUT", "/api/settings", { key: "srs.faces", value: ["listening"] });
  await api.sendJson("POST", "/api/cards/lesson", {
    series: FIXTURE_SERIES,
    lessonKey: LESSONS[0],
    edition: "ru-de",
  });
  const lesson = await api.getJson(study(`lesson:ru-de:${LESSONS[0]}`));
  expect(lesson.counts.new).toBe(4);
  expect(lesson.current.face).toBe("listening");
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
      "INSERT INTO cards (id, kind, lexeme_key, translation_lang, faces, display_cache_json, created_at) VALUES (?, 'lexeme', ?, 'ru', 'recognition', ?, 1)",
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
  const { sendJson, getJson } = await withCards();
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
    store: createRunStore({ db: profile, now: Date.now, appVersion: "test" }),
    content: createContent(openLibrary(join(root, "library"))),
    decks: { deck: () => undefined, list: () => [] },
    settings: createSettings(profile),
    session: async () => undefined,
    myCourses: async () => new Set(),
    readAudio: () => undefined,
    studiedBy: () => [],
    now: Date.now,
  });
  expect(await cards.relink()).toBe(1);
  expect(await cards.relink()).toBe(0);
  // What a card shows of its word is the word's now (a recording renamed, the word corrected).
  const shown = () =>
    JSON.parse(
      (
        sqlite
          .query("SELECT display_cache_json AS d FROM cards WHERE lexeme_key = ?")
          .get(kaffee) as {
          d: string;
        }
      ).d,
    );
  const shownBefore = shown();
  sqlite
    .query(
      "UPDATE cards SET display_cache_json = json_set(display_cache_json, '$.target', 'Kafee', '$.audio', 'media/audio/other.mp3') WHERE lexeme_key = ?",
    )
    .run(kaffee);
  expect(await cards.relink()).toBe(1);
  expect(shown()).toEqual(shownBefore);
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
  expect([word.lang, word.deck, word.state, word.due]).toEqual([
    "de",
    `course:${COURSE}`,
    "new",
    null,
  ]);
  const rate = (face: string, rating: number, reps: number) =>
    sendJson("POST", `/api/cards/${word.cardId}/review`, { id: ulid(), face, rating, reps });
  await rate("recognition", 1, 0);
  await rate("recognition", 3, 1);
  await rate("production", 3, 0);
  await sendJson("POST", "/api/cards/undo", { scope: `course:${COURSE}` });
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

test("cards remember the run they were made in; resetting the lesson removes them, also once that run is gone", async () => {
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
  expect(origins()).toEqual([]);
  // A card whose run an earlier reset removed (no origin left) still goes with its lesson.
  await sendJson("POST", "/api/runs", { series: FIXTURE_SERIES, lessonKey, edition: "ru-de" });
  await sendJson("POST", "/api/cards/lesson", {
    series: FIXTURE_SERIES,
    lessonKey,
    edition: "ru-de",
  });
  sqlite.exec("UPDATE cards SET origin_run_id = NULL");
  const reset = await sendJson("POST", "/api/progress/reset", {
    series: FIXTURE_SERIES,
    course: "demo",
    lesson: lessonKey,
  });
  expect([reset.cards, origins()]).toEqual([4, []]);
});

test("resetting a lesson removes the cards it made with their answers; another lesson's cards stay", async () => {
  const { sendJson, getJson } = await setup();
  const made: Record<string, number> = {};
  for (const lessonKey of LESSONS) {
    await sendJson("POST", "/api/runs", { series: FIXTURE_SERIES, lessonKey, edition: "ru-de" });
    made[lessonKey] = (
      await sendJson("POST", "/api/cards/lesson", {
        series: FIXTURE_SERIES,
        lessonKey,
        edition: "ru-de",
      })
    ).created;
  }
  const { current } = await getJson(study(`lesson:ru-de:${LESSONS[0]}`));
  await sendJson("POST", `/api/cards/${current.cardId}/review`, {
    id: ulid(),
    reps: 0,
    face: current.face,
    rating: 3,
  });
  const reset = await sendJson("POST", "/api/progress/reset", {
    series: FIXTURE_SERIES,
    course: "demo",
    lesson: LESSONS[0],
  });
  expect(reset.cards).toBe(made[LESSONS[0] as string]);
  const words = (await getJson("/api/cards")).words;
  expect(words).toHaveLength(made[LESSONS[1] as string] ?? 0);
  // The answer went with its card: nothing to take back.
  expect((await getJson(study("all"))).canUndo).toBe(false);
});

test("undo, then another rating: the answer is replaced; Easy takes a new word out of today's queue", async () => {
  const { sendJson, getJson } = await withCards();
  const scope = study(`lesson:ru-de:${LESSONS[0]}`);
  const first = (await getJson(scope)).current;
  const rate = (rating: number, reps: number) =>
    sendJson("POST", `/api/cards/${first.cardId}/review`, {
      id: ulid(),
      reps,
      face: first.face,
      rating,
    });
  await rate(2, 0);
  expect((await getJson(scope)).counts).toEqual({ new: 3, learning: 1, review: 0 });
  await sendJson("POST", "/api/cards/undo", { scope: `course:${COURSE}` });
  const back = await getJson(scope);
  // Taken back: the same card next, new again.
  expect([back.current.cardId, back.current.kind, back.counts.new]).toEqual([
    first.cardId,
    "new",
    4,
  ]);
  await rate(4, 0);
  const after = await getJson(scope);
  // Easy graduates it (days away): it leaves the session, as in Anki.
  expect(after.counts).toEqual({ new: 3, learning: 0, review: 0 });
  expect(after.current.cardId).not.toBe(first.cardId);
  const sheet = await getJson(`/api/cards/${first.cardId}`);
  expect(sheet.answers.map((a: { rating: number }) => a.rating)).toEqual([4]);
});

/** Begins the course (My courses): a run of its first lesson with an item skipped. */
async function begin({ sendJson }: Awaited<ReturnType<typeof setup>>) {
  const { run } = await sendJson("POST", "/api/runs", {
    series: FIXTURE_SERIES,
    lessonKey: LESSONS[0],
    edition: "ru-de",
  });
  await sendJson("POST", `/api/runs/${run.id}/events`, {
    events: [{ id: ulid(), type: "item_skipped", itemKey: `${LESSONS[0]}/ex-01#1`, payload: {} }],
  });
}

/** A second course in the library with the same words: the fixture course copied as `demo2`. */
function copyCourse(root: string) {
  const series = join(root, "library", FIXTURE_SERIES);
  const files = [...new Bun.Glob("**/*.json").scanSync({ cwd: series })].filter((f) =>
    /^(canonical|locale\/[^/]+)\/demo\//.test(f),
  );
  for (const file of files) {
    const text = readFileSync(join(series, file), "utf8");
    const to = join(series, file.replace(/(^|\/)demo\//, "$1demo2/"));
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(
      to,
      text.replace(/sprachanker\.fixture\/demo(?=[/"])/g, "sprachanker.fixture/demo2"),
    );
  }
  return { course: `${FIXTURE_SERIES}/demo2`, lesson: LESSONS[0]?.replace("/demo/", "/demo2/") };
}

test("decks to take: the courses of My courses; a course's words taken at once in course order", async () => {
  const api = await setup();
  const { sendJson, getJson } = api;
  const offer = async () =>
    (await getJson("/api/cards/decks/offers")).courses.find(
      (o: { edition: string }) => o.edition === "ru-de",
    );
  // Not begun: not offered.
  expect(await offer()).toBeUndefined();
  await begin(api);
  const before = await offer();
  expect(before).toMatchObject({ scope: `course:${COURSE}`, mine: 0 });
  expect(before.words).toBeGreaterThan(4);
  const taken = await sendJson("POST", "/api/cards/decks/take", {
    series: FIXTURE_SERIES,
    course: "demo",
    edition: "ru-de",
  });
  expect(taken.created).toBe(before.words);
  expect((await offer()).mine).toBe(before.words);
  // A lesson's words step finds its cards made already.
  expect(
    (
      await sendJson("POST", "/api/cards/lesson", {
        series: FIXTURE_SERIES,
        lessonKey: LESSONS[0],
        edition: "ru-de",
      })
    ).created,
  ).toBe(0);
  // The first new card is the course's first word.
  const first = (await getJson(study(`course:${COURSE}`))).current;
  expect(first.display.lessonKey).toBe(LESSONS[0]);
  // The deck as Review lists it: the course, its language pair.
  const deck = (await getJson("/api/cards/decks")).decks[0].decks[0];
  expect(deck).toMatchObject({ scope: `course:${COURSE}`, editions: ["ru-de"] });
});

test("leaving a deck: its cards go, studied too; a word another deck has moves there with its progress", async () => {
  const api = await setup();
  const { sendJson, getJson, root } = api;
  const other = copyCourse(root);
  // The copy's first lesson made its cards (it owns them); the fixture course's deck took the rest.
  const made = await sendJson("POST", "/api/cards/lesson", {
    series: FIXTURE_SERIES,
    lessonKey: other.lesson,
    edition: "ru-de",
  });
  expect(made.created).toBe(4);
  const taken = await sendJson("POST", "/api/cards/decks/take", {
    series: FIXTURE_SERIES,
    course: "demo",
    edition: "ru-de",
  });
  const card = (await getJson(study(`course:${other.course}`))).current;
  await sendJson("POST", `/api/cards/${card.cardId}/review`, {
    id: ulid(),
    reps: 0,
    face: card.face,
    rating: 3,
  });
  // The copy's words are all in the fixture course's deck: they move there, the studied one with its
  // progress; nothing goes.
  expect(
    await sendJson("POST", "/api/cards/decks/leave", {
      scope: `course:${other.course}`,
      lang: "de",
    }),
  ).toEqual({
    removed: 0,
    moved: 4,
  });
  const sheet = await getJson(`/api/cards/${card.cardId}`);
  expect(sheet.display.lessonKey).toBe(LESSONS[0]);
  expect(sheet.answers).toHaveLength(1);
  // No other deck has them: leaving the fixture course's deck removes every card, studied or not,
  // with its answers: today's answer to a card gone is nothing to undo.
  expect(
    await sendJson("POST", "/api/cards/decks/leave", { scope: `course:${COURSE}`, lang: "de" }),
  ).toEqual({
    removed: taken.created + 4,
    moved: 0,
  });
  expect((await getJson("/api/cards")).words).toEqual([]);
  const sqlite = new Database(join(root, "profiles/local/profile.sqlite"));
  expect(sqlite.query("SELECT count(*) AS n FROM events WHERE card_id IS NOT NULL").get()).toEqual({
    n: 0,
  });
  expect((await getJson(study("lang:de"))).canUndo).toBe(false);
});

test("more new cards today in a deck (custom study): the limit grows for it and its language", async () => {
  const { send, sendJson, getJson } = await withCards();
  await send("PUT", "/api/settings", { key: "srs.newPerDay", value: 1 });
  expect((await getJson(study(`course:${COURSE}`))).counts.new).toBe(1);
  await sendJson("POST", "/api/cards/decks/more", { scope: `course:${COURSE}`, count: 2 });
  expect((await getJson(study(`course:${COURSE}`))).counts.new).toBe(3);
  expect((await getJson(study("lang:de"))).counts.new).toBe(3);
});

test("the Review settings: a value out of range is refused, a removed option is unknown", async () => {
  const { send } = await withCards();
  expect((await send("PUT", "/api/settings", { key: "srs.retention", value: 0.5 })).status).toBe(
    400,
  );
  expect((await send("PUT", "/api/settings", { key: "srs.dayStartHour", value: 4 })).status).toBe(
    400,
  );
});

test("Undo takes back the deck's own latest answer: one in another deck is not this one's", async () => {
  const { sendJson, send, getJson } = await withCards();
  const [one, two] = LESSONS.map((key) => `lesson:ru-de:${key}`) as [string, string];
  const card = (await getJson(study(two))).current;
  await sendJson("POST", `/api/cards/${card.cardId}/review`, {
    id: ulid(),
    reps: 0,
    face: card.face,
    rating: 3,
  });
  // The first lesson's words: nothing of theirs answered today.
  expect((await getJson(study(one))).canUndo).toBe(false);
  expect((await send("POST", "/api/cards/undo", { scope: one })).status).toBe(409);
  // The second lesson's words, and the language's deck that has them, take it back.
  expect((await getJson(study("lang:de"))).canUndo).toBe(true);
  expect(await sendJson("POST", "/api/cards/undo", { scope: two })).toEqual({
    cardId: card.cardId,
    face: card.face,
  });
});
