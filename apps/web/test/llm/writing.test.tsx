// "Write it yourself" (09): no task yet — what the step is and the way to get one; a task — its
// situation, three points and length, the words counted as typed; a check — the points covered, at
// most three corrections, the criteria and a model text; earlier texts with the task they answered.
import { expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import type { WritingAttempt, WritingTaskShown } from "../../src/llm/api.ts";
import { WritingTask } from "../../src/llm/writing.tsx";
import { TargetLang } from "../../src/ui/target-lang.ts";
import { lesson } from "../lesson/lesson.ts";
import { renderApp } from "../render.tsx";

const ids = { series: "sprachanker.test", lessonKey: lesson.key, edition: "en-de" };
const llm: [unknown[], unknown] = [["llm"], { provider: "custom", model: "test-model" }];
const meta = {
  model: "lab/test-model",
  latencyMs: 10,
  runId: "01K7A0Z8ZQ4J1V2W3X4Y5Z6A71",
  itemKey: null,
  cardId: null,
};

const TASK = {
  situation: "You are meeting Lena at the café. Write her a message.",
  points: ["Say that you will be late.", "Say why.", "Say when you will be there."],
  words: 30,
};
const task: WritingTaskShown = {
  ...meta,
  task: "writing_task",
  input: "",
  result: TASK,
  id: "01K7A0Z8ZQ4J1V2W3X4Y5Z6A70",
  ts: 1,
};
const attempt = (input: string, ts: number, withTask = true): WritingAttempt => ({
  ...meta,
  task: "writing",
  input,
  id: `01K7A0Z8ZQ4J1V2W3X4Y5Z6A7${ts}`,
  ts,
  result: {
    verdict: "minor_errors",
    corrected: "Hallo Lena, ich komme später.",
    corrections: [{ wrong: "spät", right: "später", explanation: "comparative" }],
    criteria: {
      task: { score: 1, comment: "two points missing" },
      communication: { score: 2, comment: "fine" },
      accuracy: { score: 1, comment: "one error" },
    },
    ...(withTask && {
      points: [
        { score: 2, comment: "said" },
        { score: 0, comment: "no reason given" },
        { score: 0, comment: "no time given" },
      ],
      modelText: "Hallo Lena, ich komme später. Ich muss noch arbeiten. Ich bin um fünf da.",
    }),
    feedback: "Say why and when.",
  },
  ...(withTask && { writingTask: TASK }),
});

const step = (state: Record<string, unknown>) =>
  renderApp(
    <TargetLang value="de">
      <WritingTask {...ids} />
    </TargetLang>,
    {
      path: "/",
      data: [
        llm,
        [
          ["writing", ids.lessonKey, ids.edition],
          { task: null, words: [], attempts: [], checking: null, preparing: false, ...state },
        ],
      ],
    },
  );

test("no task yet: what the step is and the way to get one; one being written keeps it waiting", async () => {
  const none = await step({});
  expect(none.getByText(/A short text on a situation from the lesson/)).toBeTruthy();
  expect(none.getByRole("button", { name: "Get a task" })).toBeTruthy();
  expect(none.queryByRole("textbox")).toBeNull();
  none.unmount();

  const waiting = await step({ preparing: true });
  const button = waiting.getByRole("button", { name: /Writing a task…/ });
  expect(button.hasAttribute("disabled")).toBe(true);
  waiting.unmount();
});

test("a task: its situation, three points and length; the words counted as typed; a new task offered", async () => {
  const view = await step({ task, words: ["der Kaffee, die Kaffees"] });
  expect(view.getByText("Your task (write in German):")).toBeTruthy();
  expect(view.getByText(TASK.situation)).toBeTruthy();
  for (const point of TASK.points) expect(view.getByText(point)).toBeTruthy();
  expect(view.getByText("About 30 words.")).toBeTruthy();
  expect(view.getByText("der Kaffee")).toBeTruthy();
  expect(view.getByText("0 words of about 30")).toBeTruthy();
  fireEvent.change(view.getByRole("textbox", { name: "Your text…" }), {
    target: { value: "Hallo Lena, ich komme spät — sorry!" },
  });
  expect(view.getByText("6 words of about 30")).toBeTruthy();
  expect(view.getByRole("button", { name: "New task" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Check" }).hasAttribute("disabled")).toBe(false);
  view.unmount();
});

test("a check: the task's points as covered, the corrections, the criteria and a model text; an earlier text opens with its task", async () => {
  const older = {
    ...attempt("Hallo Lena.", 2),
    writingTask: { ...TASK, situation: "Older task." },
  };
  const view = await step({ task, attempts: [attempt("Hallo Lena, ich komme spät.", 3), older] });
  expect(view.getByText("Say why and when.")).toBeTruthy();
  expect(view.getByText("The task's points")).toBeTruthy();
  expect(view.getByText("no reason given")).toBeTruthy();
  expect(view.getByText(/comparative/)).toBeTruthy();
  expect(view.getByText("Model text")).toBeTruthy();
  expect(view.getByText(/Ich muss noch arbeiten/)).toBeTruthy();
  expect(view.getByText("two points missing")).toBeTruthy();
  // The earlier text, opened, shows the task it answered.
  expect(view.getByText("Earlier texts of this lesson")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: /Hallo Lena\./ }));
  expect(view.getByText("Older task.")).toBeTruthy();
  view.unmount();
});

test("a check from before tasks had points: no points, no model text", async () => {
  const view = await step({ task, attempts: [attempt("Ich heisse Lena.", 4, false)] });
  expect(view.getByText("Say why and when.")).toBeTruthy();
  expect(view.queryByText("The task's points")).toBeNull();
  expect(view.queryByText("Model text")).toBeNull();
  view.unmount();
});
