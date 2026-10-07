import { expect, test } from "bun:test";
import { exerciseResults, stepsDone } from "@sprachanker/engine";
import type { StepId, StoredEvent } from "@sprachanker/schema";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useLessonFlow } from "../../src/lesson/use-flow.ts";
import { answered, lesson, locale } from "./lesson.ts";

/** A run as `useRun` gives it, recording what the flow asks for. */
function fakeRun(
  mode: "none" | "active" | "finished",
  events: StoredEvent[] = [],
  resumePage = -1,
) {
  const calls: string[] = [];
  const run = {
    mode,
    run: mode === "none" ? undefined : { id: "R1", result: null },
    results: exerciseResults(events),
    done: stepsDone(events),
    mistakes: [],
    resumePage,
    pageShown: (i: number) => calls.push(`page ${i}`),
    stepDone: (id: StepId, skipped = false) => calls.push(`step ${id}${skipped ? " skipped" : ""}`),
    start: async (restart = false) => {
      calls.push(restart ? "restart" : "start");
    },
    finish: async () => {
      calls.push("finish");
      return null;
    },
  };
  return { run, calls };
}

const flow = (run: ReturnType<typeof fakeRun>["run"]) =>
  renderHook(() => useLessonFlow({ lesson, locale, practice: [], run: run as never }));

test("the plan: overview, words, reading pages, exercises, summary; it opens on the overview", () => {
  const { result } = flow(fakeRun("none").run);
  expect(result.current.ids).toEqual([
    "overview",
    "words",
    "grammar:0",
    "exercise:0",
    "exercise:1",
    "culture:0",
    "summary",
  ]);
  expect(result.current.current).toBe("overview");
  expect([result.current.worked, result.current.todo]).toEqual([0, 5]);
});

test("opening a step of a lesson never started starts it, then records the step", async () => {
  const { run, calls } = fakeRun("none");
  const { result } = flow(run);
  act(() => result.current.go("exercise:1"));
  await waitFor(() => expect(calls).toEqual(["start", "page 1"]));
  expect(result.current.current).toBe("exercise:1");
});

test("in an active run: a reading page is recorded once, a skip is a skip, Next goes on", () => {
  const { run, calls } = fakeRun("active");
  const { result } = flow(run);
  act(() => result.current.go("grammar:0"));
  act(() => result.current.mark("words", true));
  act(() => result.current.next());
  expect(calls).toEqual(["step grammar:0", "step words skipped", "page 0"]);
  expect(result.current.current).toBe("exercise:0");
});

test("an active run resumes on the exercise last shown while it is not worked", () => {
  const { result } = flow(fakeRun("active", [], 1).run);
  expect(result.current.current).toBe("exercise:1");
});

test("reaching the summary with every step worked completes the run, once", async () => {
  const events = [
    answered("ex-01#1", "a"),
    answered("ex-02#1", "b"),
    ...(["words", "grammar:0", "culture:0"] as const).map(
      (step, i) =>
        ({
          id: `S${i}`,
          runId: "R",
          ts: 10 + i,
          type: "step_done",
          itemKey: null,
          payload: { step },
        }) as StoredEvent,
    ),
  ];
  const { run, calls } = fakeRun("active", events);
  const { result, rerender } = flow(run);
  act(() => result.current.show("summary"));
  await waitFor(() => expect(calls).toEqual(["finish"]));
  rerender();
  expect(calls).toEqual(["finish"]);
});

test("starting over begins with the first step after the overview", async () => {
  const { run, calls } = fakeRun("finished");
  const { result } = flow(run);
  await act(() => result.current.begin(true));
  expect(calls).toEqual(["restart"]);
  expect(result.current.current).toBe("words");
});
