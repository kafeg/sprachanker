import { expect, test } from "bun:test";
import { exerciseResults, lessonSteps, stepsDone } from "@sprachanker/engine";
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
