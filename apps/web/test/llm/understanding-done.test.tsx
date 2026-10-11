// The Understanding step's last answer (09): the run is read again first (a wrong answer puts going
// over mistakes in the plan), and only then is the step done — never the other way round.
import { expect, mock, test } from "bun:test";
import type { UnderstandingText } from "@sprachanker/schema";
import { fireEvent, waitFor } from "@testing-library/react";
import type { Understood } from "../../src/llm/api.ts";
import * as api from "../../src/llm/api.ts";
import { TargetLang } from "../../src/ui/target-lang.ts";
import { lesson } from "../lesson/lesson.ts";
import { renderApp } from "../render.tsx";

const TEXT: UnderstandingText = {
  kind: "reading",
  title: "Menu",
  situation: "",
  lines: [{ text: "Kaffee 2,50 €" }],
  glossary: [],
  questions: [
    { phase: "reading", question: "Was kostet der Kaffee?", options: ["2 €", "2,50 €"], answer: 1 },
  ],
};
const text = (answers: Understood["answers"]): Understood => ({
  task: "understanding",
  input: "",
  result: TEXT,
  model: "lab/test-model",
  latencyMs: 10,
  id: "01K7A0Z8ZQ4J1V2W3X4Y5Z6A70",
  runId: "01K7A0Z8ZQ4J1V2W3X4Y5Z6A71",
  itemKey: null,
  cardId: null,
  ts: 1_790_000_000_000,
  answers,
});

// The server's answer, as it would come: the question answered wrong.
mock.module("../../src/llm/api.ts", () => ({
  ...api,
  useAnswerUnderstanding: () => ({
    isPending: false,
    error: null,
    mutate: (_: unknown, options: { onSuccess(after: Understood): void }) =>
      options.onSuccess(
        text([
          {
            verdict: "01K7A0Z8ZQ4J1V2W3X4Y5Z6A70",
            question: 0,
            answer: { optionId: "a" },
            outcome: { result: "wrong", score: 0 },
            ts: 2,
          },
        ]),
      ),
  }),
}));
const { UnderstandingStep } = await import("../../src/llm/understanding.tsx");

test("the last answer kept: the run read again, then the step done", async () => {
  const order: string[] = [];
  let reread: () => void = () => {};
  const view = await renderApp(
    <TargetLang value="de">
      <UnderstandingStep
        series="sprachanker.test"
        lessonKey={lesson.key}
        edition="en-de"
        onStored={() =>
          new Promise<void>((resolve) => {
            order.push("stored");
            reread = () => {
              order.push("read");
              resolve();
            };
          })
        }
        onDone={() => order.push("done")}
      />
    </TargetLang>,
    {
      data: [
        [["llm"], { provider: "custom", model: "test-model" }],
        [["understanding", lesson.key], { texts: [text([])], preparing: false }],
      ],
    },
  );
  fireEvent.click(view.getByRole("button", { name: /^2\s€$/ }));
  const check = view.queryByRole("button", { name: "Check" });
  if (check) fireEvent.click(check);
  await waitFor(() => expect(order).toEqual(["stored"]));
  reread();
  await waitFor(() => expect(order).toEqual(["stored", "read", "done"]));
  view.unmount();
});
