import { expect, test } from "bun:test";
import type { FaceState } from "@sprachanker/schema";
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
      {
        start: today - 40 * DAY,
        lesson: 0,
        exam: 0,
        review: 9,
        newCards: 0,
        recalled: 9,
        remembered: 0,
        ai: 0,
      },
      {
        start: today - DAY,
        lesson: 0,
        exam: 0,
        review: 5,
        newCards: 1,
        recalled: 4,
        remembered: 3,
        ai: 0,
      },
    ],
    today,
  );
  expect(standing.words).toEqual({ new: 1, learning: 1, review: 1, mature: 1, suspended: 1 });
  expect(standing.due).toEqual({ today: 1, tomorrow: 2, week: 4 });
  expect(standing.answers).toBe(5);
  expect(standing.remembered).toBe(0.75);
});
