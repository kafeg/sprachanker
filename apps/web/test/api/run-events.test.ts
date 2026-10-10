import { expect, test } from "bun:test";
import type { TypedEvent } from "@sprachanker/schema";
import { withStored } from "../../src/api/run-events.ts";

const answer = (id: string, attempt: number, outcome?: unknown) =>
  ({
    id,
    runId: "R",
    ts: 1,
    type: "answered",
    itemKey: "k#1",
    cardId: null,
    payload: { answer: {}, attempt, ms: 1, ...(outcome ? { outcome } : {}) },
  }) as TypedEvent;

test("the server's outcome and attempt of each answer replace the local ones; a mock exam's attempt alone", () => {
  const right = { result: "correct", score: 1, ruleIds: [], lexemes: [] };
  const local = { result: "wrong", score: 0, ruleIds: [], lexemes: [] };
  const events = [answer("a", 1, local), answer("b", 1), answer("c", 1, local)];
  const shown = withStored(events, { outcomes: { a: right as never }, attempts: { a: 2, b: 3 } });
  expect(
    shown.map((e) =>
      e.type === "answered" ? `${e.payload.attempt} ${e.payload.outcome?.result ?? "none"}` : "",
    ),
  ).toEqual(["2 correct", "3 none", "1 wrong"]);
  // Untouched events stay the same objects.
  expect(shown[2]).toBe(events[2] as TypedEvent);
});
