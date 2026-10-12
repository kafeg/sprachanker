import { expect, test } from "bun:test";
import { exerciseResults } from "@sprachanker/engine";
import type { Exercise } from "@sprachanker/schema";
import { act, renderHook } from "@testing-library/react";
import { type Answered, useExercise } from "../../src/lesson/use-exercise.ts";
import { answered, lesson } from "./lesson.ts";

const KEY = "sprachanker.test/demo/00-01/ex-05";
/** Two choice items, the second with its own recording. */
const exercise = {
  key: KEY,
  type: "single_choice",
  fingerprint: "x",
  newWords: [],
  ruleIds: [],
  items: [1, 2].map((n) => ({
    key: `${KEY}#${n}`,
    ...(n === 2 && { media: { audio: "media/audio/b.mp3" } }),
    options: [
      { id: "a", text: "Ja." },
      { id: "b", text: "Nein." },
    ],
    answer: { optionIds: ["a"] },
  })),
} as unknown as Exercise;

function exerciseHook(
  ex = exercise,
  stored?: Parameters<typeof useExercise>[0]["stored"],
  readOnly = false,
) {
  const sent: Array<Parameters<Answered>> = [];
  const hook = renderHook(() =>
    useExercise({ exercise: ex, stored, readOnly, lang: "de", onAnswered: (...a) => sent.push(a) }),
  );
  return { ...hook, sent };
}

test("Check waits for every answer, then for the recordings, and checks what is open", () => {
  const { result, sent } = exerciseHook();
  expect(result.current.waiting).toEqual({ for: "answers", done: 0, total: 2 });
  act(() => result.current.answer(0, { optionId: "a" }));
  act(() => result.current.answer(1, { optionId: "b" }));
  expect(result.current.waiting).toEqual({ for: "item recording", n: 2 });
  expect(result.current.canCheck).toBe(false);
  act(() => result.current.hear("item-1"));
  expect(result.current.canCheck).toBe(true);
  act(() => result.current.check());
  expect(Object.values(result.current.outcomes ?? {}).map((o) => o.result)).toEqual([
    "correct",
    "wrong",
  ]);
  expect(sent[0]?.[0].map((a) => [a.itemKey, a.outcome.result])).toEqual([
    [`${KEY}#1`, "correct"],
    [`${KEY}#2`, "wrong"],
  ]);
  expect(result.current.checking).toBe(false);
});

test("an item answered again is the only one Check checks; a retry clears everything", () => {
  const { result, sent } = exerciseHook();
  act(() => result.current.answer(0, { optionId: "a" }));
  act(() => result.current.answer(1, { optionId: "b" }));
  act(() => result.current.hear("item-1"));
  act(() => result.current.check());
  act(() => result.current.toggleExplain(1));
  const [first, second] = [result.current.cardKey(0), result.current.cardKey(1)];
  act(() => result.current.answerAgain(1));
  // Only the item answered again is made anew (its renderer's state, its players at the start).
  expect([result.current.cardKey(0), result.current.cardKey(1) === second]).toEqual([first, false]);
  expect(result.current.explaining.has(1)).toBe(false);
  expect(result.current.activeItem).toBe(1);
  act(() => result.current.answer(1, { optionId: "a" }));
  act(() => result.current.check());
  expect(sent[1]?.[0].map((a) => [a.itemKey, a.outcome.result])).toEqual([[`${KEY}#2`, "correct"]]);
  const round = result.current.round;
  act(() => result.current.retry());
  expect([result.current.outcomes, result.current.answers]).toEqual([undefined, {}]);
  // Every card and the exercise's own media made anew.
  expect(result.current.round).toBe(round + 1);
  expect(result.current.cardKey(0)).not.toBe(first);
});

test("reopened: the run's latest answers and outcomes are back, nothing to listen to again", () => {
  const stored = exerciseResults([answered("ex-01#1", "b"), answered("ex-01#1", "a", 2)])[
    lesson.pages[0]?.exercise.key as string
  ];
  const { result } = exerciseHook(lesson.pages[0]?.exercise, stored);
  expect(result.current.answers).toEqual({ 0: { optionId: "a" } });
  expect(result.current.outcomes?.[0]?.result).toBe("correct");
  expect(result.current.checking).toBe(false);
});

test("skipping records every item as skipped; leaving a scored exercise records nothing", () => {
  const { result, sent } = exerciseHook();
  act(() => result.current.leave());
  expect(sent).toEqual([]);
  act(() => result.current.skip());
  expect(sent[0]?.[1]).toEqual([`${KEY}#1`, `${KEY}#2`]);
});

test("a speaking exercise: each take recorded as it is made, the rest skipped on leaving", () => {
  const selfrate = {
    ...exercise,
    type: "speech_selfrate",
    items: [1, 2].map((n) => ({ key: `${KEY}#${n}`, text: `Satz ${n}` })),
  } as unknown as Exercise;
  const { result, sent } = exerciseHook(selfrate);
  expect(result.current.checking).toBe(false);
  act(() => result.current.answer(0, { recording: "01K00000000000000000000000" }));
  // A take is recorded as it is made (a reload keeps it), each take again as the item's answer.
  expect(sent).toHaveLength(1);
  expect(sent[0]?.[0]).toMatchObject([
    { itemKey: `${KEY}#1`, answer: { recording: "01K00000000000000000000000" } },
  ]);
  act(() => result.current.answer(0, { recording: "01K00000000000000000000001" }));
  expect(sent).toHaveLength(2);
  // Leaving records only what is left: the item not said, skipped.
  act(() => result.current.leave());
  expect(sent[2]?.[0]).toEqual([]);
  expect(sent[2]?.[1]).toEqual([`${KEY}#2`]);
});

test("a finished run is read-only: nothing to check", () => {
  const { result } = exerciseHook(exercise, undefined, true);
  expect([result.current.checking, result.current.waiting]).toEqual([false, undefined]);
});
