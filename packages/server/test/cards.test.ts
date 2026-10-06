import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { setup } from "./setup.ts";

const LESSON = "sprachanker.fixture/demo/00-01";
const KAFFEE = "lex:de:kaffee:noun:m";
const words = { series: FIXTURE_SERIES, lessonKey: LESSON, edition: "ru-de" };

test("a lesson's words become cards: one per word, kept when met again, known ones set aside", async () => {
  const { sendJson, getJson } = await setup();
  const first = await sendJson("POST", "/api/cards/lesson", { ...words, known: [KAFFEE] });
  expect(first.created).toBe(4);
  expect((await sendJson("POST", "/api/cards/lesson", { ...words, known: [] })).created).toBe(0);
  const lessonCards = (key: string) =>
    getJson(`/api/cards/lesson?series=${FIXTURE_SERIES}&lessonKey=${key}`);
  const { words: lesson } = await lessonCards(LESSON);
  expect(Object.keys(lesson)).toHaveLength(4);
  expect(lesson[KAFFEE]).toMatchObject({ suspended: true, state: "new" });
  // The second lesson's words have no cards yet.
  expect((await lessonCards(`${FIXTURE_SERIES}/demo/00-02`)).words).toEqual({});
  const list = (await getJson("/api/cards")).words;
  const kaffee = list.find((w: { lexemeKey: string }) => w.lexemeKey === KAFFEE);
  expect(kaffee.display).toMatchObject({
    target: "der Kaffee, die Kaffees",
    gender: "m",
    lessonKey: LESSON,
  });
  expect(kaffee.display.translation).toBe("кофе");
});

test("review: new faces within the day's limit; a rated face is stored with its event and leaves the queue", async () => {
  const { send, sendJson, getJson, root } = await setup();
  const sqlite = new Database(join(root, "profiles/local/profile.sqlite"));
  await send("PUT", "/api/settings", { key: "srs.newPerDay", value: 2 });
  await sendJson("POST", "/api/cards/lesson", { ...words, known: [KAFFEE] });
  const queue = await getJson("/api/cards/review");
  expect(queue).toMatchObject({ newPerDay: 2, newToday: 0 });
  expect(queue.items).toHaveLength(2);
  expect(
    queue.items.every((i: { face: string; isNew: boolean }) => i.face === "recognition" && i.isNew),
  ).toBe(true);
  // The due time after each rating, again earliest.
  const [a, b] = queue.items;
  expect(a.due[1]).toBeLessThan(a.due[3]);

  const rated = await sendJson("POST", `/api/cards/${a.cardId}/review`, {
    face: "recognition",
    rating: 3,
  });
  expect(rated.state.reps).toBe(1);
  await sendJson("POST", `/api/cards/${b.cardId}/review`, { face: "recognition", rating: 1 });
  // Both new faces of the day are used: nothing new is offered, the rated faces are not due yet.
  const after = await getJson("/api/cards/review");
  expect([after.newToday, after.items.length]).toEqual([2, 0]);

  const reviews = sqlite
    .query(
      "SELECT e.card_id, r.kind FROM events e JOIN runs r ON r.id = e.run_id WHERE e.type = 'card_review'",
    )
    .all();
  expect(reviews).toEqual([
    { card_id: a.cardId, kind: "review" },
    { card_id: b.cardId, kind: "review" },
  ]);
  const states = sqlite.query("SELECT card_id, face FROM card_state ORDER BY card_id").all();
  expect(states).toHaveLength(2);
  const mine = (await getJson("/api/cards")).words;
  expect(mine.find((w: { cardId: string }) => w.cardId === a.cardId).state).toBe("learning");
});

test("already known: a card set aside leaves the queue and comes back; unknown cards are refused", async () => {
  const { send, sendJson, getJson } = await setup();
  await sendJson("POST", "/api/cards/lesson", { ...words, known: [] });
  const [first] = (await getJson("/api/cards/review")).items;
  await sendJson("PUT", `/api/cards/${first.cardId}`, { suspended: true });
  const ids = async () =>
    (await getJson("/api/cards/review")).items.map((i: { cardId: string }) => i.cardId);
  expect(await ids()).not.toContain(first.cardId);
  await sendJson("PUT", `/api/cards/${first.cardId}`, { suspended: false });
  expect(await ids()).toContain(first.cardId);
  const missing = "01HZZZZZZZZZZZZZZZZZZZZZZZ";
  expect((await send("PUT", `/api/cards/${missing}`, { suspended: true })).status).toBe(404);
  expect(
    (await send("POST", `/api/cards/${missing}/review`, { face: "recognition", rating: 3 })).status,
  ).toBe(404);
  // A face the card does not have is refused too.
  expect(
    (await send("POST", `/api/cards/${first.cardId}/review`, { face: "listening", rating: 3 }))
      .status,
  ).toBe(404);
});
