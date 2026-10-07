import { expect, test } from "bun:test";
import type { CardReviewPayload, FaceState } from "@sprachanker/schema";
import { type CardEvent, cardDay } from "../src/srs/day.ts";

const state = (s: number): FaceState => ({
  due: 0,
  stability: 1,
  difficulty: 5,
  scheduledDays: 0,
  learningSteps: 0,
  reps: 1,
  lapses: 0,
  state: s,
});
const review = (id: string, cardId: string, before: FaceState | null): CardEvent => ({
  id,
  ts: 0,
  type: "card_review",
  cardId,
  payload: {
    face: "recognition",
    rating: 3,
    stateBefore: before,
    stateAfter: state(1),
  } satisfies CardReviewPayload,
});
const undo = (id: string, cardId: string, of: string): CardEvent => ({
  id,
  ts: 0,
  type: "card_undo",
  cardId,
  payload: { review: of },
});

test("a day of card answers: what each deck used, what Undo takes back, the face just taken back", () => {
  // Newest first: a new card, a review, then the new card taken back.
  const events = [
    undo("u1", "a", "r3"),
    review("r3", "a", null),
    review("r2", "b", state(2)),
    review("r1", "c", null),
  ];
  const day = cardDay(events);
  expect(day.answers.map((a) => a.id)).toEqual(["r2", "r1"]);
  expect(day.undoable?.id).toBe("r2");
  expect(day.justUndone).toEqual({ cardId: "a", face: "recognition" });
  expect(day.used(new Set(["a", "b", "c"]))).toEqual({ fresh: 1, reviews: 1 });
  // Each deck counts its own cards.
  expect(day.used(new Set(["b"]))).toEqual({ fresh: 0, reviews: 1 });
  // Something answered after the undo: nothing is "just taken back" any more.
  expect(cardDay([review("r4", "d", null), ...events]).justUndone).toBeUndefined();
  expect(cardDay([]).undoable).toBeUndefined();
});

test("a face passed today: its latest answer not taken back was Good or Easy", () => {
  const again = (id: string, cardId: string): CardEvent => {
    const e = review(id, cardId, null);
    return e.type === "card_review" ? { ...e, payload: { ...e.payload, rating: 1 } } : e;
  };
  // Newest first: "a" answered Again then Good; "b" Good then Again; "c" Good taken back.
  const day = cardDay([
    review("r4", "a", state(1)),
    again("r3", "a"),
    again("r2", "b"),
    review("r1", "b", null),
    undo("u0", "c", "r0"),
    review("r0", "c", null),
  ]);
  expect(day.passed("a", "recognition")).toBe(true);
  expect(day.passed("b", "recognition")).toBe(false);
  expect(day.passed("c", "recognition")).toBe(false);
  expect(day.passed("a", "production")).toBe(false);
});
