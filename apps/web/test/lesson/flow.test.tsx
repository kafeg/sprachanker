import { expect, test } from "bun:test";
import { exerciseResults, stepsDone } from "@sprachanker/engine";
import type { StepId, TypedEvent } from "@sprachanker/schema";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useLessonFlow } from "../../src/lesson/use-flow.ts";
import { answered, lesson, locale } from "./lesson.ts";

/** A run as `useRun` gives it, recording what the flow asks for. */
function fakeRun(mode: "none" | "active" | "finished", events: TypedEvent[] = [], resumePage = -1) {
  const calls: string[] = [];
  const run = {
    mode,
    run: mode === "none" ? undefined : { id: "R1", result: null },
    results: exerciseResults(events),
    done: stepsDone(events),
    mistakes: [],
    events,
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

test("a lesson never started, opened on a step (a reload, a link), starts there; the overview starts nothing", async () => {
  const { run, calls } = fakeRun("none");
  const { result } = renderHook(() =>
    useLessonFlow({ lesson, locale, practice: [], run: run as never, opened: "exercise:1" }),
  );
  await waitFor(() => expect(calls).toEqual(["start", "page 1"]));
  expect(result.current.current).toBe("exercise:1");

  const quiet = fakeRun("none");
  renderHook(() =>
    useLessonFlow({ lesson, locale, practice: [], run: quiet.run as never, opened: "overview" }),
  );
  await new Promise((r) => setTimeout(r, 20));
  expect(quiet.calls).toEqual([]);
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

test("the AI practice still unknown: the run resumes only once every step is known", () => {
  const run = fakeRun("active", [], 1).run;
  const { result, rerender } = renderHook(
    ({ practice }: { practice?: readonly ("writing" | "speaking")[] }) =>
      useLessonFlow({ lesson, locale, practice, run: run as never }),
    {
      initialProps: { practice: undefined } as {
        practice?: readonly ("writing" | "speaking")[];
      },
    },
  );
  expect(result.current.current).toBe("overview");
  rerender({ practice: ["writing"] });
  expect(result.current.ids).toContain("writing");
  expect(result.current.current).toBe("exercise:1");
});

test("every exercise worked and AI practice left: the run resumes on the practice step once it is known", () => {
  const step = (id: string): TypedEvent =>
    ({
      id: `S-${id}`,
      runId: "R1",
      ts: 1,
      type: "step_done",
      itemKey: null,
      payload: { step: id },
    }) as TypedEvent;
  const events = [
    answered("ex-01#1", "a"),
    answered("ex-02#1", "a"),
    step("words"),
    step("grammar:0"),
    step("culture:0"),
  ];
  const run = fakeRun("active", events, 1).run;
  const { result, rerender } = renderHook(
    ({ practice }: { practice?: readonly ("writing" | "speaking")[] }) =>
      useLessonFlow({ lesson, locale, practice, run: run as never }),
    {
      initialProps: { practice: undefined } as {
        practice?: readonly ("writing" | "speaking")[];
      },
    },
  );
  expect(result.current.current).toBe("overview");
  rerender({ practice: ["writing"] });
  expect(result.current.current).toBe("writing");
});

test("a page opened on a step stays on it instead of resuming (a reload); moving updates the address", () => {
  const shown: string[] = [];
  const { result } = renderHook(() =>
    useLessonFlow({
      lesson,
      locale,
      practice: [],
      run: fakeRun("active", [], 1).run as never,
      opened: "overview",
      onShow: (id) => shown.push(id),
    }),
  );
  expect(result.current.current).toBe("overview");
  act(() => result.current.go("words"));
  expect(shown).toEqual(["words"]);
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
        }) as TypedEvent,
    ),
  ];
  const { run, calls } = fakeRun("active", events);
  const { result, rerender } = flow(run);
  act(() => result.current.show("summary"));
  await waitFor(() => expect(calls).toEqual(["finish"]));
  rerender();
  expect(calls).toEqual(["finish"]);
});

test("a run started here shows its first step, not where an earlier visit would resume", async () => {
  const before = fakeRun("none");
  const { result, rerender } = renderHook(
    ({ run }) => useLessonFlow({ lesson, locale, practice: [], run: run as never }),
    { initialProps: { run: before.run } },
  );
  await act(() => result.current.begin(false));
  expect(result.current.current).toBe("words");
  // The run now active, its first steps recorded: resuming would jump past the words.
  const done = ["words", "grammar:0"].map(
    (step, i) =>
      ({
        id: `S${i}`,
        runId: "R1",
        ts: i,
        type: "step_done",
        itemKey: null,
        payload: { step },
      }) as TypedEvent,
  );
  rerender({ run: fakeRun("active", done, 0).run });
  expect(result.current.current).toBe("words");
});

test("starting over begins with the first step after the overview", async () => {
  const { run, calls } = fakeRun("finished");
  const { result } = flow(run);
  await act(() => result.current.begin(true));
  expect(calls).toEqual(["restart"]);
  expect(result.current.current).toBe("words");
});
