// An AI practice step's bar (09): until the step is done its main button is Check, waiting for the page
// (a text to answer, a task to say) — never Next; Skip passes it by. Done, Next; the page's own Check
// while it needs one.
import { expect, test } from "bun:test";
import { PracticeStep } from "../../src/lesson/practice-step.tsx";
import type { LessonSlots } from "../../src/lesson/slots.ts";
import { renderApp } from "../render.tsx";
import { lesson, locale } from "./lesson.ts";

const bar = (
  done: boolean,
  slots: LessonSlots = { practice: { useKinds: () => [], step: () => null } },
) =>
  renderApp(
    <PracticeStep
      kind="reading"
      lesson={lesson}
      locale={locale}
      run={
        {
          done: new Map(done ? [["reading", "done"]] : []),
          retry: async () => {},
        } as never
      }
      slots={slots}
      context={{ series: "sprachanker.test", lessonKey: lesson.key, edition: "en-de" }}
      mark={() => {}}
      onBack={() => {}}
      onNext={() => {}}
    />,
  );

test("not done: Check waits, Skip is there; done: Next, no Skip", async () => {
  const before = await bar(false);
  const check = before.getByRole("button", { name: "Check" }) as HTMLButtonElement;
  expect(check.disabled).toBe(true);
  expect(before.queryByRole("button", { name: "Next" })).toBeNull();
  expect(before.getByRole("button", { name: "Skip" })).toBeTruthy();
  before.unmount();
  const after = await bar(true);
  expect(after.getByRole("button", { name: "Next" })).toBeTruthy();
  expect(after.queryByRole("button", { name: "Skip" })).toBeNull();
  after.unmount();
});
