import { expect, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { lessonAssistant } from "../../src/llm/lesson-assistant.tsx";
import { useAiIn } from "../../src/llm/setup-api.ts";
import { queryClient } from "../render.tsx";

const MODEL = { provider: "custom", model: "m", providers: [] };
const LESSON = {
  series: "sprachanker.test",
  lessonKey: "sprachanker.test/demo/01-01",
  edition: "ru-de",
};
const hook = <T,>(
  use: () => T,
  settings: Record<string, unknown>,
  llm: unknown = MODEL,
  pack?: unknown,
) => {
  const client = queryClient([
    [["llm"], llm],
    [["settings"], settings],
    ...(pack
      ? [
          [["practice-lesson", LESSON.series, LESSON.lessonKey, LESSON.edition], pack] as [
            unknown[],
            unknown,
          ],
        ]
      : []),
  ]);
  return renderHook(use, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  }).result.current;
};

const pack = (made: Record<string, number>) =>
  Object.fromEntries(Object.entries(made).map(([step, n]) => [step, { made: n, left: n }]));

test("the practice steps the course's practice has for the lesson, a model or not; a place turned off: its steps not there", () => {
  const kinds = () => lessonAssistant.practice?.useKinds(LESSON);
  const all = pack({ reading: 3, listening: 3, writing: 3, speaking: 3 });
  expect(hook(kinds, {}, MODEL, all)).toEqual(["reading", "listening", "writing", "speaking"]);
  expect(hook(kinds, { "llm.offIn": ["scene", "tutor"] }, MODEL, all)).toEqual([
    "reading",
    "listening",
    "writing",
  ]);
  expect(hook(kinds, { "llm.offIn": ["understanding"] }, MODEL, all)).toEqual([
    "writing",
    "speaking",
  ]);
  const none = { provider: null, model: null, providers: [] };
  const some = pack({ reading: 1, listening: 0, writing: 2, speaking: 1 });
  expect(hook(kinds, {}, none, some)).toEqual(["reading", "writing", "speaking"]);
  expect(hook(kinds, {}, MODEL, some)).toEqual(["reading", "writing", "speaking"]);
  expect(hook(kinds, { "llm.offIn": ["scene"] }, none, some)).toEqual(["reading", "writing"]);
  expect(
    hook(kinds, {}, MODEL, pack({ reading: 0, listening: 0, writing: 0, speaking: 0 })),
  ).toEqual([]);
  expect(hook(() => useAiIn("explain"), { "llm.offIn": ["explain"] })).toBe(false);
  expect(hook(() => useAiIn("example"), { "llm.offIn": ["explain"] })).toBe(true);
});

test('"Why is this wrong?" offered only while it can answer: a model set up and its place on', () => {
  const on = () => lessonAssistant.explain?.useOn();
  expect(hook(on, {})).toBe(true);
  expect(hook(on, { "llm.offIn": ["explain"] })).toBe(false);
  expect(hook(on, {}, { provider: null, model: null, providers: [] })).toBe(false);
});
