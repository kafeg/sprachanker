import { expect, test } from "bun:test";
import { exerciseResults, lessonSteps, type PracticeResult, stepsDone } from "@sprachanker/engine";
import { fireEvent } from "@testing-library/react";
import { LessonSummary } from "../../src/lesson/summary.tsx";
import { renderApp } from "../render.tsx";
import { answered, lesson, locale } from "./lesson.ts";

test("the summary: the score with right at first try, what is left, every step with its state", async () => {
  const events = [answered("ex-01#1", "b"), answered("ex-01#1", "a", 2)];
  const gone: string[] = [];
  const view = await renderApp(
    <LessonSummary
      series="sprachanker.test"
      course="demo"
      lesson={lesson}
      locale={locale}
      steps={lessonSteps(lesson, locale)}
      results={exerciseResults(events)}
      done={stepsDone(events)}
      practice={new Map()}
      result={{ score: 0, scored: 1, answered: 1 }}
      mode="active"
      go={(id) => gone.push(id)}
      redo={() => {}}
    />,
    { path: "/lesson/sprachanker.test/demo/00-01" },
  );
  expect(await view.findByText("0%")).toBeTruthy();
  expect(view.getByText(/Correct on the first try: 0 of 1/)).toBeTruthy();
  const first = view.getByRole("button", { name: /First/ });
  expect(first.textContent).toContain("0/1");
  expect(view.getByRole("button", { name: /Second/ }).textContent).toContain("not done");
  fireEvent.click(first);
  expect(gone).toEqual(["exercise:0"]);
});

test("the AI practice marked as exercises are, with how many were right; the mistakes gone over under the steps", async () => {
  const practice = new Map<"reading" | "writing", PracticeResult>([
    ["reading", { mark: "partial", right: 3, of: 5 }],
    ["writing", { mark: "correct" }],
  ]);
  const done = new Map([
    ["reading", "done"],
    ["writing", "done"],
  ] as const);
  const view = await renderApp(
    <LessonSummary
      series="sprachanker.test"
      course="demo"
      lesson={lesson}
      locale={locale}
      steps={lessonSteps(lesson, locale, ["reading", "writing", "speaking"])}
      results={{}}
      done={done}
      practice={practice}
      mistakes={<p>Going over: here</p>}
      result={null}
      mode="active"
      go={() => {}}
      redo={() => {}}
    />,
    { path: "/lesson/sprachanker.test/demo/00-01" },
  );
  expect((await view.findByRole("button", { name: /Reading/ })).textContent).toContain("3/5");
  const writing = view.getByRole("button", { name: /Writing/ });
  expect(writing.textContent).toContain("right");
  expect(view.getByRole("button", { name: /Speaking/ }).textContent).toContain("not done");
  expect(view.getByRole("heading", { name: "Going over mistakes" })).toBeTruthy();
  expect(view.getByText("Going over: here")).toBeTruthy();
});
