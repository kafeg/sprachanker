// An AI practice step's bar: until the step is worked its main button is Check, waiting for the
// page (a text to answer, a task to say) — never Next; Skip passes it by. Done, Next; worked but not
// recorded, recorded now.
import { expect, test } from "bun:test";
import { PracticeStep } from "../../src/lesson/practice-step.tsx";
import type { LessonSlots } from "../../src/lesson/slots.ts";
import { renderApp } from "../render.tsx";
import { lesson, locale } from "./lesson.ts";

const marked: string[] = [];
const bar = (
  done: boolean,
  worked = false,
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
          practice: new Map(worked ? [["reading", { mark: "partial" }]] : []),
          retry: async () => {},
        } as never
      }
      slots={slots}
      context={{ series: "sprachanker.test", lessonKey: lesson.key, edition: "en-de" }}
      mark={(id: string) => marked.push(id)}
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

test("worked in the run but not recorded (a reply lost): done now, Next", async () => {
  marked.length = 0;
  const view = await bar(false, true);
  expect(marked).toEqual(["reading"]);
  expect(view.getByRole("button", { name: "Next" })).toBeTruthy();
  view.unmount();
});
