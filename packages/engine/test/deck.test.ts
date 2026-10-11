import { expect, test } from "bun:test";
import type { FaceState } from "@sprachanker/schema";
import type { CardAnswer } from "../src/srs/day.ts";
import { deckStanding } from "../src/srs/deck.ts";

const DAY = 86_400_000;
const today = Date.UTC(2026, 9, 10);
const face = (state: number, due: number, scheduledDays = 1): FaceState => ({
  due,
  stability: 1,
  difficulty: 5,
  scheduledDays,
  learningSteps: 0,
  reps: 1,
  lapses: 0,
  state,
});
/** An answer to a card, rated `rating`, of a face `before` it in that state (null: new). */
const answer = (ts: number, rating: number, before: number | null): CardAnswer => ({
  id: String(ts),
  runId: "R",
  ts,
  cardId: "c",
  face: "recognition",
  review: {
    face: "recognition",
    rating,
    stateBefore: before === null ? null : face(before, ts),
    stateAfter: face(2, ts + DAY),
  },
});

test("a deck's words by state, mature ones apart, what is due, the month's answers", () => {
  const standing = deckStanding(
    [
      { suspended: false, faces: [{ suspended: false }, { suspended: false }] },
      // Learning on one face: learning.
      {
        suspended: false,
        faces: [
          { state: face(1, today + 600_000), suspended: false },
          { state: face(2, today + 3 * DAY, 3), suspended: false },
        ],
      },
      // In review, due tomorrow and in five days.
      {
        suspended: false,
        faces: [
          { state: face(2, today + DAY + 1000, 5), suspended: false },
          { state: face(2, today + 5 * DAY, 5), suspended: false },
        ],
      },
      // Every face three weeks or more ahead: mature; a suspended face is not due.
      {
        suspended: false,
        faces: [
          { state: face(2, today + 30 * DAY, 30), suspended: false },
          { state: face(2, today - DAY, 25), suspended: true },
        ],
      },
      { suspended: true, faces: [{ state: face(2, today - DAY), suspended: false }] },
    ],
    [
      // Before the month: not counted.
      ...Array.from({ length: 9 }, () => answer(today - 40 * DAY, 1, 2)),
      // Yesterday: a new card, and of four in review three remembered.
      answer(today - DAY, 3, null),
      answer(today - DAY, 3, 2),
      answer(today - DAY, 4, 2),
      answer(today - DAY, 2, 2),
      answer(today - DAY, 1, 2),
    ],
    today,
  );
  expect(standing.words).toEqual({ new: 1, learning: 1, review: 1, mature: 1, suspended: 1 });
  expect(standing.due).toEqual({ today: 1, tomorrow: 2, week: 4 });
  expect(standing.answers).toBe(5);
  expect(standing.remembered).toBe(0.75);
});
