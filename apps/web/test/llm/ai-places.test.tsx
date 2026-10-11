import { expect, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { lessonAssistant } from "../../src/llm/lesson-assistant.tsx";
import { useAiIn } from "../../src/llm/setup-api.ts";
import { queryClient } from "../render.tsx";

const MODEL = { provider: "custom", model: "m", providers: [] };
const hook = <T,>(use: () => T, settings: Record<string, unknown>, llm: unknown = MODEL) => {
  const client = queryClient([
    [["llm"], llm],
    [["settings"], settings],
  ]);
  return renderHook(use, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  }).result.current;
};

test("a place turned off: not there; the tutor off takes the mistakes step with it", () => {
  const kinds = () => lessonAssistant.practice?.useKinds();
  expect(hook(kinds, {})).toEqual(["understanding", "writing", "scene", "mistakes"]);
  expect(hook(kinds, { "llm.offIn": ["scene", "tutor"] })).toEqual(["understanding", "writing"]);
  expect(hook(kinds, { "llm.offIn": ["understanding"] })).toEqual(["writing", "scene", "mistakes"]);
  expect(hook(kinds, {}, { provider: null, model: null, providers: [] })).toEqual([]);
  expect(hook(() => useAiIn("explain"), { "llm.offIn": ["explain"] })).toBe(false);
  expect(hook(() => useAiIn("example"), { "llm.offIn": ["explain"] })).toBe(true);
});
