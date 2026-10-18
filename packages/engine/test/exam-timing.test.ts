// An exam's times beside its modules': a Teil's own or its share of the module's, a module's
// preparation in the mock exam's time, and a preparation as a run's events hold it.
import { expect, test } from "bun:test";
import {
  type Exam,
  examItemKey,
  examKey,
  examSectionKey,
  type TypedEvent,
} from "@sprachanker/schema";
import { timeOf } from "../src/exam/index.ts";
import { preparationIn, preparationLeft, preparationOf, teilTime } from "../src/exam/timing.ts";

const B1 = examKey("goethe.de/b1" as never, "modell");
const teil = (id: string, module: string, own?: number) => ({
  key: examSectionKey(B1, id),
  module,
  pool: [examItemKey(B1, id)],
  draw: 1,
  filter: null,
  ...(own && { timeLimitSec: own }),
});
const exam: Exam = {
  format: 1,
  key: B1,
  timeLimitSec: 3600 + 900 + 900,
  modules: [
    { id: "schreiben", timeLimitSec: 3600 },
    { id: "sprechen", timeLimitSec: 900, preparationSec: 900 },
  ],
  sections: [
    teil("s1", "schreiben"),
    teil("s2", "schreiben"),
    teil("s3", "schreiben"),
    teil("p1", "sprechen", 180),
    teil("p2", "sprechen", 180),
    teil("p3", "sprechen"),
  ],
  items: ["s1", "s2", "s3", "p1", "p2", "p3"].map((id) => ({
    key: examItemKey(B1, id),
    type: "respond",
    tags: {},
    input: id.startsWith("p") ? "speech" : "text",
    reference: [],
  })),
  thresholds: [{ id: "overall", minPoints: 60 }],
};

test("a Teil's time: its own as its page states, else an equal share of its module's", () => {
  expect(teilTime(exam, examSectionKey(B1, "p2"))).toBe(180);
  expect(teilTime(exam, examSectionKey(B1, "p3"))).toBe(300);
  expect(teilTime(exam, examSectionKey(B1, "s1"))).toBe(1200);
  expect(teilTime(exam, "nowhere")).toBeUndefined();
  // A test of drawn questions has no modules: its Teile no time of their own.
  const { modules: _, ...plain } = exam;
  expect(teilTime(plain, examSectionKey(B1, "p3"))).toBeUndefined();
});

test("a module's preparation: in its mock exam's time, none where it has none", () => {
  expect(preparationOf(exam, "sprechen")).toBe(900);
  expect(preparationOf(exam, "schreiben")).toBeUndefined();
  expect(timeOf(exam, "sprechen")).toBe(1800);
  expect(timeOf(exam, "schreiben")).toBe(3600);
  expect(timeOf(exam)).toBe(5400);
});

const notes = (ts: number, payload: Record<string, unknown>): TypedEvent =>
  ({
    id: `e${ts}`,
    runId: "r",
    ts,
    type: "exam_notes",
    itemKey: null,
    payload: { module: "sprechen", notes: {}, ...payload },
  }) as TypedEvent;

test("a preparation as kept: begun with its first notes, the latest notes, over once begun or out of time", () => {
  const q1 = examItemKey(B1, "p1");
  expect(preparationIn([], "sprechen")).toEqual({ notes: {}, done: false });
  const events = [
    notes(1000, {}),
    notes(5000, { notes: { [q1]: "Mittwoch" } }),
    notes(6000, { module: "schreiben", notes: { [q1]: "elsewhere" } }),
  ];
  const kept = preparationIn(events, "sprechen");
  expect(kept).toEqual({ began: 1000, notes: { [q1]: "Mittwoch" }, done: false });
  expect(preparationLeft(kept, 900, 2000)).toBe(899_000);
  expect(preparationLeft(kept, 900, 1000 + 900_000)).toBeUndefined();
  // Not begun yet: all of it left.
  expect(preparationLeft({ notes: {}, done: false }, 900, 7)).toBe(900_000);
  const begun = preparationIn(
    [...events, notes(8000, { notes: { [q1]: "Mittwoch" }, done: true })],
    "sprechen",
  );
  expect(begun.done).toBe(true);
  expect(preparationLeft(begun, 900, 9000)).toBeUndefined();
});
