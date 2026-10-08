import { expect, test } from "bun:test";
import type { ExerciseKey } from "@sprachanker/schema";
import { SpokenAnswerCheck } from "../../src/llm/spoken-check.tsx";
import { TargetLang } from "../../src/ui/target-lang.ts";
import { renderApp } from "../render.tsx";

const RUN = "01K00000000000000000000000";
const props = {
  series: "s.x",
  lessonKey: "s.x/c/00-01",
  edition: "ru-de",
  exerciseKey: "s.x/c/00-01/ex-02" as ExerciseKey,
  index: 1,
  transcript: "Hallo gute Tag",
  runId: RUN,
  onStored() {},
};
const kept = {
  checks: [
    {
      itemKey: "s.x/c/00-01/ex-02#2",
      transcript: "Hallo gute Tag",
      model: "google/gemma",
      ts: 2,
      result: {
        verdict: "minor_errors",
        corrected: "Hallo, guten Tag",
        corrections: [{ wrong: "gute", right: "guten", explanation: "der Tag" }],
        feedback: "Almost right.",
      },
    },
  ],
};

test("a kept check of the words heard: verdict, feedback, what was said corrected, the corrections", async () => {
  const view = await renderApp(
    <TargetLang.Provider value="de">
      <SpokenAnswerCheck {...props} />
    </TargetLang.Provider>,
    {
      data: [
        [["llm"], { provider: "custom", model: "m", providers: [] }],
        [["spoken", RUN], kept],
      ],
    },
  );
  expect(view.getByText("Small mistakes")).toBeTruthy();
  expect(view.getByText("Almost right.")).toBeTruthy();
  expect(view.getByText(/— der Tag/)).toBeTruthy();
  expect(view.getByText("gemma")).toBeTruthy();
});

test("without a model nothing is shown or asked", async () => {
  const view = await renderApp(<SpokenAnswerCheck {...props} />, {
    data: [
      [["llm"], { provider: null, model: null, providers: [] }],
      [["spoken", RUN], { checks: [] }],
    ],
  });
  expect(view.container.textContent).toBe("");
});
