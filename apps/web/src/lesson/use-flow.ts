// The lesson's flow over its plan (09): which step is shown (kept in the page's address, so a reload stays
// on it), moving between steps and what that records, starting or starting over, resuming an active run
// where it was left when the lesson is opened without a step, and completing it on the summary.
// The decisions are the engine's (`resumeStep`, `openingRecord`); this hook keeps the screen's state.
import {
  type LessonStep,
  lessonSteps,
  openingRecord,
  type PracticeKind,
  planCoverage,
  recordedStep,
  resumeStep,
  stepId,
} from "@sprachanker/engine";
import type { Lesson, LessonResult, LocaleLesson } from "@sprachanker/schema";
import { useEffect, useRef, useState } from "react";
import type { useRun } from "./use-run.ts";

type Run = ReturnType<typeof useRun>;

export function useLessonFlow({
  lesson,
  locale,
  practice,
  run,
  opened,
  onShow,
}: {
  lesson: Lesson | undefined;
  locale: LocaleLesson | null | undefined;
  /** The AI practice offered; undefined while not known yet (the flow resumes only once it is). */
  practice: readonly PracticeKind[] | undefined;
  run: Run;
  /** The step the page was opened on (its address): kept on reload instead of resuming elsewhere. */
  opened?: string;
  /** A step is shown: the page's address follows it. */
  onShow?(id: string): void;
}) {
  const [current, setCurrent] = useState(opened ?? "overview");
  const openedOn = useRef(opened);
  const [finished, setFinished] = useState<LessonResult | null>();
  /** Starting a run: one request at a time (a double click starts one run), its failure shown. */
  const [startState, setStartState] = useState<{ busy: boolean; error?: unknown }>({ busy: false });
  /** Finishing is tried once per run: a refusal is shown, not asked again in a loop. */
  const finishTried = useRef<string>(undefined);
  const [finishError, setFinishError] = useState<unknown>();

  const steps = lesson ? lessonSteps(lesson, locale, practice ?? []) : [];
  const ids = steps.map(stepId);
  const coverage = lesson
    ? planCoverage(steps, lesson, run.results, run.done, ids.indexOf(current))
    : undefined;
  const active = run.mode === "active";
  const resumeId =
    active && lesson ? resumeStep(steps, lesson, run.results, run.done, run.resumePage) : undefined;

  // Once per run loaded (not while the learner works through it), in the same render — the overview
  // never shows for a frame first.
  const runLoaded = active && lesson && practice ? run.run?.id : undefined;
  const [resumedFor, setResumedFor] = useState<string>();
  /** A run started here (Start, Start over, opening a step) is not resumed: its first step is shown. */
  const startedHere = useRef(false);
  if (runLoaded && resumedFor !== runLoaded) {
    setResumedFor(runLoaded);
    if (resumeId && !openedOn.current && !startedHere.current) setCurrent(resumeId);
  }

  // Reaching the summary with every step done or skipped completes an active run (05, "Lifecycle").
  const { finish } = run;
  const complete = !!coverage?.complete;
  const runId = run.run?.id;
  useEffect(() => {
    if (current !== "summary" || !active || !complete || !runId || finishTried.current === runId)
      return;
    finishTried.current = runId;
    finish().then(setFinished).catch(setFinishError);
  }, [current, active, complete, finish, runId]);

  const at = Math.max(0, ids.indexOf(current));
  const starting = async (start: () => Promise<void>) => {
    if (startState.busy) return false;
    setStartState({ busy: true });
    try {
      startedHere.current = true;
      await start();
      setStartState({ busy: false });
      return true;
    } catch (error) {
      setStartState({ busy: false, error });
      return false;
    }
  };
  const show = (id: string) => {
    setCurrent(id);
    onShow?.(id);
    window.scrollTo({ top: 0 });
  };
  /** Records what opening a step records (the engine's `openingRecord`). */
  const record = (target: LessonStep, fresh = false) => {
    if (!lesson) return;
    const { pageShown, stepDone } = openingRecord(target, { done: run.done, fresh });
    if (pageShown !== undefined) run.pageShown(pageShown);
    if (stepDone) run.stepDone(stepDone);
  };
  /** Moves to a step. In an active run it is recorded; opening a step of a lesson never started
   *  starts it; a finished run is only looked at. */
  const go = (id: string) => {
    show(id);
    const target = steps[ids.indexOf(id)];
    if (!target || target.kind === "overview" || target.kind === "summary") return;
    if (active) record(target);
    else if (run.mode === "none")
      void starting(() => run.start()).then((ok) => ok && record(target, true));
  };
  // A lesson never started, opened on one of its steps (its address: a reload, a link): opening the
  // step starts it as moving to it does, so what is answered there has a run to be stored in.
  const openStarted = useRef(false);
  useEffect(() => {
    if (openStarted.current || run.mode !== "none" || !lesson) return;
    const target = steps[ids.indexOf(current)];
    if (!target || target.kind === "overview" || target.kind === "summary") return;
    openStarted.current = true;
    void starting(() => run.start()).then((ok) => ok && record(target, true));
  });
  /** Records a step besides the exercises as done or skipped (in an active run). */
  const mark = (id: string, skipped = false) => {
    const step = steps[ids.indexOf(id)];
    const recorded = step && recordedStep(step);
    if (active && recorded && run.done.get(recorded) !== (skipped ? "skipped" : "done"))
      run.stepDone(recorded, skipped);
  };
  /** Starts the lesson (anew when `restart`) and opens its first step after the overview. */
  const begin = async (restart: boolean) => {
    if (!(await starting(() => run.start(restart)))) return;
    setFinished(undefined);
    const first = steps[1];
    if (!first) return;
    show(stepId(first));
    record(first, true);
  };

  return {
    steps,
    ids,
    at,
    current,
    step: steps[at],
    worked: coverage?.worked ?? 0,
    /** The steps worked and the one shown while still to do: the header's count. */
    reached: coverage?.reached ?? 0,
    todo: coverage?.total ?? 0,
    resumeId,
    /** The score shown: of the run just finished, or of the latest finished run. */
    result: finished ?? (run.mode === "finished" ? run.run?.result : undefined),
    busy: startState.busy,
    error: startState.error ?? finishError,
    show,
    go,
    next: () => go(ids[at + 1] ?? "summary"),
    back: () => go(ids[at - 1] ?? "overview"),
    mark,
    begin,
    /** After progress was reset: nothing of the old run is shown. */
    forget: () => setFinished(undefined),
  };
}
