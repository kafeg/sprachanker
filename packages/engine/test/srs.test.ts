import { expect, test } from "bun:test";
import type { FaceState } from "@sprachanker/schema";
import { intervals, type QueueCard, review, reviewQueue, wordState } from "../src/srs/index.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 6, 9);

test("a new face reviewed good is due later than one reviewed again; easy later still", () => {
  const again = review(undefined, 1, NOW);
  const good = review(undefined, 3, NOW);
  const easy = review(undefined, 4, NOW);
  expect(again.due).toBeLessThan(good.due);
  expect(good.due).toBeLessThanOrEqual(easy.due);
  expect(good.reps).toBe(1);
  expect(good.lastReview).toBe(NOW);
});

test("reviewing on time grows the interval; forgetting counts a lapse and shortens it", () => {
  let s = review(undefined, 3, NOW);
  s = review(s, 3, s.due);
  s = review(s, 3, s.due);
  const longer = review(s, 3, s.due);
  expect(longer.due - s.due).toBeGreaterThan(s.due - (s.lastReview ?? 0));
  const lapse = review(longer, 1, longer.due);
  expect(lapse.lapses).toBe(1);
  expect(lapse.due).toBeLessThan(longer.due + DAY);
});

test("intervals: one due time per rating, in order", () => {
  const due = intervals(undefined, NOW);
  expect(due[1]).toBeLessThan(due[3]);
  expect(due[3]).toBeLessThanOrEqual(due[4]);
});

const card = (id: string, extra: Partial<QueueCard> = {}): QueueCard => ({
  id,
  faces: ["recognition", "production"],
  suspended: false,
  createdAt: 0,
  states: {},
  ...extra,
});
const state = (due: number, stability = 1, phase = 2): FaceState => ({
  due,
  stability,
  difficulty: 5,
  scheduledDays: 1,
  learningSteps: 0,
  reps: 1,
  lapses: 0,
  state: phase,
});

test("queue: due faces first, most overdue first; then new ones within the day's limit", () => {
  const queue = reviewQueue(
    [
      card("new-1", { createdAt: 1 }),
      card("due-late", { states: { recognition: state(NOW - DAY) } }),
      card("new-2", { createdAt: 2 }),
      card("due-early", { states: { recognition: state(NOW - 2 * DAY) } }),
      // Recognition still being learnt: production is not introduced yet.
      card("not-yet", { states: { recognition: state(NOW + DAY, 1, 1) } }),
      card("known", { suspended: true }),
    ],
    { now: NOW, newPerDay: 3, newToday: 2 },
  );
  expect(queue.map((e) => [e.cardId, e.face, e.isNew])).toEqual([
    ["due-early", "recognition", false],
    ["due-late", "recognition", false],
    ["new-1", "recognition", true],
  ]);
});

test("queue: a card shows one face a day; after again that face comes back the same day", () => {
  const learnt = card("a", {
    states: { recognition: state(NOW - DAY), production: state(NOW - DAY) },
  });
  // Both faces due: only one is offered.
  expect(reviewQueue([learnt], { now: NOW }).map((e) => e.face)).toEqual(["recognition"]);
  // Recognition reviewed today and due again (again → minutes): only it comes back.
  const again = { ...learnt, reviewedToday: "recognition" as const };
  expect(reviewQueue([again], { now: NOW }).map((e) => e.face)).toEqual(["recognition"]);
  // Recognition done for today: production waits for tomorrow.
  const done = card("b", {
    states: { recognition: state(NOW + DAY), production: state(NOW - DAY) },
    reviewedToday: "recognition",
  });
  expect(reviewQueue([done], { now: NOW })).toEqual([]);
  // A card whose first face was introduced today gets no new face the same day.
  const introduced = card("c", {
    states: { recognition: state(NOW + DAY) },
    reviewedToday: "recognition",
  });
  expect(reviewQueue([introduced], { now: NOW })).toEqual([]);
  // The next day, its recognition in review, its production face is new.
  expect(reviewQueue([{ ...introduced, reviewedToday: undefined }], { now: NOW })).toMatchObject([
    { cardId: "c", face: "production", isNew: true },
  ]);
});

test("word state: new, learning, long-term from 21 days of stability", () => {
  expect(wordState({})).toBe("new");
  expect(wordState({ recognition: state(NOW, 3) })).toBe("learning");
  expect(wordState({ recognition: state(NOW, 3), production: state(NOW, 25) })).toBe("long_term");
});
