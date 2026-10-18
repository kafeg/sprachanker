// A course's preparation on its page: the source's answers heard — how many are ready, the job's
// progress and Stop, what holds it (a model, a stop), what failed —, and the steps a feature adds; its
// button, with the hearing's progress on it.
import { expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { CoursePrep, CoursePrepButton, HeardLine } from "../../src/library/course-prep.tsx";
import { server } from "../llm/practice-lesson.ts";
import { renderApp } from "../render.tsx";

const IDS = { series: "s", course: "c", edition: "ru-de" };
const KEY = ["course-heard", "s", "c"];
const STATE = {
  recordings: 360,
  heard: 342,
  failed: 0,
  missing: 0,
  waiting: false,
  stopped: false,
  job: null,
};
const job = (state: string) => ({
  series: "s",
  course: "c",
  total: 10,
  done: 3,
  current: [],
  failed: [],
  state,
  startedAt: 1,
  endedAt: null,
});

test("how many answers are ready; while heard, the lesson it is at and Stop", async () => {
  const done = await renderApp(<CoursePrep {...IDS} />, { data: [[KEY, STATE]] });
  expect(done.getByText("342 of 360 answers ready")).toBeTruthy();
  expect(done.getByRole("button", { name: "Hear them" })).toBeTruthy();
  done.unmount();

  const running = await renderApp(<CoursePrep {...IDS} />, {
    data: [[KEY, { ...STATE, job: job("running") }]],
  });
  expect(running.getByText("Hearing: lesson 3 of 10")).toBeTruthy();
  const asked = server(() => ({ ...STATE, job: job("stopping") }));
  fireEvent.click(running.getByRole("button", { name: "Stop" }));
  await waitFor(() =>
    expect(asked[0]).toBe('POST /api/course/heard/stop {"series":"s","course":"c"}'),
  );
  running.unmount();
});

test("what holds it: a speech model, a stop (Continue), recordings that failed (Try again), files not downloaded", async () => {
  const waiting = await renderApp(<CoursePrep {...IDS} />, {
    data: [[KEY, { ...STATE, heard: 0, waiting: true }]],
  });
  expect(waiting.getByText(/Waiting for a speech model/)).toBeTruthy();
  waiting.unmount();

  const stopped = await renderApp(<CoursePrep {...IDS} />, {
    data: [[KEY, { ...STATE, stopped: true }]],
  });
  const asked = server(() => STATE);
  fireEvent.click(stopped.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(asked[0]).toBe('POST /api/course/heard {"series":"s","course":"c"}'));
  stopped.unmount();

  const failed = await renderApp(<CoursePrep {...IDS} />, {
    data: [[KEY, { ...STATE, heard: 350, failed: 4, missing: 6 }]],
  });
  expect(failed.getByText("4 could not be heard")).toBeTruthy();
  expect(failed.getByRole("button", { name: "Try again" })).toBeTruthy();
  expect(failed.getByText("6 recordings are not downloaded yet")).toBeTruthy();
  failed.unmount();
});

test("a card shows the hearing only while it works or waits", async () => {
  const idle = await renderApp(<HeardLine series="s" course="c" compact />, {
    data: [[KEY, STATE]],
  });
  expect(idle.container.textContent).toBe("");
  idle.unmount();
  const running = await renderApp(<HeardLine series="s" course="c" compact />, {
    data: [[KEY, { ...STATE, job: job("running") }]],
  });
  expect(running.getByText("Hearing: lesson 3 of 10")).toBeTruthy();
  running.unmount();
});

test("its button: none with nothing to prepare; the hearing's progress on it while it runs", async () => {
  const none = await renderApp(<CoursePrepButton {...IDS} open={false} onToggle={() => {}} />, {
    data: [[KEY, { ...STATE, recordings: 0, heard: 0 }]],
  });
  expect(none.queryByRole("button")).toBeNull();
  none.unmount();
  let toggled = 0;
  const running = await renderApp(
    <CoursePrepButton {...IDS} open={false} onToggle={() => toggled++} />,
    { data: [[KEY, { ...STATE, job: job("running") }]] },
  );
  const button = running.getByRole("button", { name: /Course preparation · answers 342 of 360/ });
  expect(button.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(button);
  expect(toggled).toBe(1);
  running.unmount();
});
