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

test("a place turned off: its practice steps not there; without a model, those the course's practice has", () => {
  const kinds = () => lessonAssistant.practice?.useKinds(LESSON);
  expect(hook(kinds, {})).toEqual(["reading", "listening", "writing", "speaking"]);
  expect(hook(kinds, { "llm.offIn": ["scene", "tutor"] })).toEqual([
    "reading",
    "listening",
    "writing",
  ]);
  expect(hook(kinds, { "llm.offIn": ["understanding"] })).toEqual(["writing", "speaking"]);
  const none = { provider: null, model: null, providers: [] };
  const pack = { reading: 1, listening: 0, writing: 2, speaking: 1 };
  expect(hook(kinds, {}, none, pack)).toEqual(["reading", "writing", "speaking"]);
  expect(hook(kinds, { "llm.offIn": ["scene"] }, none, pack)).toEqual(["reading", "writing"]);
  expect(hook(kinds, {}, none, { reading: 0, listening: 0, writing: 0, speaking: 0 })).toEqual([]);
  expect(hook(() => useAiIn("explain"), { "llm.offIn": ["explain"] })).toBe(false);
  expect(hook(() => useAiIn("example"), { "llm.offIn": ["explain"] })).toBe(true);
});

test('"Why is this wrong?" offered only while it can answer: a model set up and its place on', () => {
  const on = () => lessonAssistant.explain?.useOn();
  expect(hook(on, {})).toBe(true);
  expect(hook(on, { "llm.offIn": ["explain"] })).toBe(false);
  expect(hook(on, {}, { provider: null, model: null, providers: [] })).toBe(false);
});
