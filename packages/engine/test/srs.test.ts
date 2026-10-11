import { expect, test } from "bun:test";
import type { FaceState } from "@sprachanker/schema";
import {
  faceStage,
  intervals,
  intervalText,
  isLeech,
  lessonFace,
  type QueueFace,
  review,
  studyDay,
  studyQueue,
  wordState,
} from "../src/srs/index.ts";

const MIN = 60_000;
const DAY = 86_400_000;
const NOW = new Date(2026, 9, 6, 12).getTime();
const NEXT = new Date(2026, 9, 7, 4).getTime();

test("a new face: again, hard, good stay in the learning steps (1m 10m), easy graduates", () => {
  const due = intervals(undefined, NOW, "c1:recognition");
  expect(due[1] - NOW).toBe(MIN);
  expect(due[2] - NOW).toBe(6 * MIN);
  expect(due[3] - NOW).toBe(10 * MIN);
  expect(due[4] - NOW).toBeGreaterThanOrEqual(DAY);
  expect(review(undefined, 3, NOW, "c1:recognition").state).toBe(1);
});

test("the interval a button shows is the one the answer gets, whenever it is given", () => {
  const face = "c1:recognition";
  let s = review(undefined, 3, NOW, face);
  s = review(s, 3, s.due, face);
  s = review(s, 3, s.due + 3 * DAY, face);
  const shown = intervals(s, s.due, face);
  for (const rating of [1, 2, 3, 4] as const)
    expect(review(s, rating, s.due + 7_000, face).due - (s.due + 7_000)).toBe(
      shown[rating] - s.due,
    );
});

test("good through the steps graduates; forgetting relearns for 10 minutes and counts a lapse", () => {
  let s = review(undefined, 3, NOW, "c1:recognition");
  s = review(s, 3, s.due, "c1:recognition");
  expect(s.state).toBe(2);
  expect(s.due - (s.lastReview ?? 0)).toBeGreaterThanOrEqual(DAY);
  const lapse = review(s, 1, s.due, "c1:recognition");
  expect([lapse.state, lapse.lapses, lapse.due - (lapse.lastReview ?? 0)]).toEqual([
    3,
    1,
    10 * MIN,
  ]);
});

test("interval text as in Anki", () => {
  const u = { s: "s", m: "m", h: "h", d: "d", mo: "mo", y: "y" };
  expect(intervalText(MIN, u)).toBe("<1m");
  expect(intervalText(10 * MIN, u)).toBe("<10m");
  expect(intervalText(25 * MIN, u)).toBe("25m");
  expect(intervalText(90 * MIN, u)).toBe("1.5h");
  expect(intervalText(4 * DAY, u)).toBe("4d");
  expect(intervalText(36 * DAY, u)).toBe("1.2mo");
  expect(intervalText(400 * DAY, u)).toBe("1.1y");
});

test("the study day starts at 4 AM", () => {
  const night = new Date(2026, 9, 7, 2).getTime();
  expect(studyDay(night).start).toBe(new Date(2026, 9, 6, 4).getTime());
  expect(studyDay(NOW).next).toBe(NEXT);
});

const state = (due: number, phase: number, stability = 3): FaceState => ({
  due,
  stability,
  difficulty: 5,
  scheduledDays: 1,
  learningSteps: 0,
  reps: 1,
  lapses: 0,
  state: phase,
});
const face = (cardId: string, extra: Partial<QueueFace> = {}): QueueFace => ({
  cardId,
  face: "recognition",
  position: 0,
  ...extra,
});

test("queue: learning due first, then reviews mixed with new cards; counts as in Anki", () => {
  const { queue, counts } = studyQueue(
    [
      face("r1", { state: state(NOW - DAY, 2) }),
      face("r2", { state: state(NOW + 3600_000, 2) }), // due later today: due today
      face("tomorrow", { state: state(NEXT + 1, 2) }),
      face("l1", { state: state(NOW - MIN, 1) }),
      face("ahead", { state: state(NOW + 5 * MIN, 1) }),
      face("n1", { position: 1 }),
      face("n2", { position: 2 }),
    ],
    { now: NOW, nextDay: NEXT },
  );
  expect(queue[0]).toMatchObject({ cardId: "l1", kind: "learning" });
  // Spread evenly: a new card after every review here (two of each).
  expect(queue.slice(1).map((e) => e.kind)).toEqual(["review", "new", "review", "new"]);
  expect(counts).toEqual({ new: 2, learning: 2, review: 2 });
});

test("queue: a face in FSRS's own new state is new", () => {
  const { counts } = studyQueue([face("imported", { state: state(NOW, 0) })], {
    now: NOW,
    nextDay: NEXT,
  });
  expect(counts).toEqual({ new: 1, learning: 0, review: 0 });
});

test("queue: new cards by card type — every card 1 before any card 2 — within the day's limits", () => {
  const faces: QueueFace[] = [1, 2, 3].flatMap((n) => [
    face(`c${n}`, { position: n }),
    face(`c${n}`, { position: n, face: "production" }),
  ]);
  const { queue, newWaiting } = studyQueue(faces, { now: NOW, nextDay: NEXT, newPerDay: 4 });
  // Gathered by position (c1, c1', c2, c2'), shown by card type.
  expect(queue.map((e) => `${e.cardId}:${e.face}`)).toEqual([
    "c1:recognition",
    "c2:recognition",
    "c1:production",
    "c2:production",
  ]);
  expect(newWaiting).toBe(true);
  // New cards also count against the review limit; a lesson's own words ignore the new limit.
  expect(studyQueue(faces, { now: NOW, nextDay: NEXT, reviewsPerDay: 1 }).queue).toHaveLength(1);
  // New faces introduced today used the review limit too: 4 − 3 leaves one.
  expect(
    studyQueue(faces, { now: NOW, nextDay: NEXT, reviewsPerDay: 4, newToday: 3 }).queue,
  ).toHaveLength(1);
  expect(
    studyQueue(faces, { now: NOW, nextDay: NEXT, newToday: 20, allNew: true }).queue,
  ).toHaveLength(6);
});

test("queue: suspended and buried faces are left out; learning cards come early when nothing is left", () => {
  const { queue, counts, buried, nextLearning } = studyQueue(
    [
      face("s", { suspended: true }),
      face("b", { buriedUntil: NEXT }),
      face("soon", { state: state(NOW + 5 * MIN, 1) }),
      face("later", { state: state(NOW + 60 * MIN, 1) }),
    ],
    { now: NOW, nextDay: NEXT },
  );
  expect(queue.map((e) => e.cardId)).toEqual(["soon"]);
  expect([counts.learning, buried, nextLearning]).toEqual([1, 1, NOW + 5 * MIN]);
});

test("word state and leeches", () => {
  expect(wordState({})).toBe("new");
  expect(wordState({ recognition: state(NOW, 2) })).toBe("review");
  expect(wordState({ recognition: state(NOW, 2), production: state(NOW, 3) })).toBe("learning");
  expect(wordState({ recognition: state(NOW, 1) })).toBe("learning");
  expect(faceStage(state(NOW, 0))).toBe("new");
  expect(isLeech({ ...state(NOW, 2), lapses: 8 })).toBe(true);
});

test("answers left today, if each is Good: two per new face, a learning face's steps left, one per review", () => {
  const learningAt = (step: number, due: number): FaceState => ({
    ...state(due, 1),
    learningSteps: step,
  });
  const { answersLeft } = studyQueue(
    [
      face("new1"),
      face("new2"),
      face("first step", { state: learningAt(0, NOW + MIN) }),
      face("last step", { state: learningAt(1, NOW + 10 * MIN) }),
      face("relearning", { state: { ...state(NOW, 3), learningSteps: 0 } }),
      face("review", { state: state(NOW - DAY, 2) }),
      face("tomorrow", { state: state(NEXT + DAY, 2) }),
    ],
    { now: NOW, nextDay: NEXT },
  );
  expect(answersLeft).toBe(2 + 2 + 2 + 1 + 1 + 1);
});

test("a lesson's words are studied by recognition, else by the card's first face in order", () => {
  expect(lessonFace(["production", "recognition"])).toBe("recognition");
  expect(lessonFace(["listening", "production"])).toBe("production");
  expect(lessonFace(["listening"])).toBe("listening");
});
