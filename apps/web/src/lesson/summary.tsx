// The lesson summary (09): the run's score, what is left while it is open, every step of the plan with
// its state (exercises with their right answers), and the way on.
import {
  type ExerciseResult,
  type LessonStep,
  planCoverage,
  stepId,
  stepState,
} from "@sprachanker/engine";
import type { Lesson, LessonResult, LocaleLesson, StepId } from "@sprachanker/schema";
import { parseLessonKey } from "@sprachanker/schema";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/button.tsx";
import { StepDot, stepTitle } from "./plan.tsx";

export function LessonSummary({
  series,
  course,
  lesson,
  locale,
  steps,
  results,
  done,
  result,
  mode,
  nextLesson,
  go,
  redo,
}: {
  series: string;
  course: string;
  lesson: Lesson;
  locale: LocaleLesson | null;
  steps: LessonStep[];
  results: Record<string, ExerciseResult>;
  done: Map<StepId, "done" | "skipped">;
  /** Score of the run shown, once it is finished. */
  result: LessonResult | null | undefined;
  /** The run shown: still open (what is left is listed), finished (can be done again), or none. */
  mode: "none" | "active" | "finished";
  nextLesson?: string;
  go(id: string): void;
  redo(): void;
}) {
  const { t, i18n } = useTranslation();
  const coverage = planCoverage(steps, lesson, results, done);
  // Items right at the first attempt (the score itself also weighs partial answers).
  const firstCorrect = Object.values(results)
    .flatMap((r) => Object.values(r.first))
    .filter((o) => o.result === "correct").length;
  const todo = steps.filter((s) => s.kind !== "overview" && s.kind !== "summary");
  return (
    <section className="space-y-6">
      <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        {t("lesson.summary")}
      </p>
      <h1 className="text-4xl font-bold">{locale?.title}</h1>
      {lesson.pages.length > 0 && (
        <div className="flex items-end gap-4">
          <span className="font-heading text-6xl font-bold">
            {result
              ? new Intl.NumberFormat(i18n.language, { style: "percent" }).format(result.score)
              : "—"}
          </span>
          {result && (
            <span className="pb-2 text-muted-foreground">
              {t("lesson.score", { correct: firstCorrect, scored: result.scored })}
            </span>
          )}
        </div>
      )}
      {mode === "active" && coverage.firstLeft !== undefined && (
        <div className="space-y-3 rounded-2xl bg-accent px-5 py-4">
          <p>{t("lesson.stepsLeft", { count: coverage.total - coverage.worked })}</p>
          <Button
            size="lg"
            onClick={() => go(stepId(steps[coverage.firstLeft as number] as LessonStep))}
          >
            {t("lesson.toStep", {
              title: stepTitle(steps[coverage.firstLeft] as LessonStep, lesson, locale, t),
            })}
          </Button>
        </div>
      )}
      {mode === "finished" && (
        <Button size="lg" onClick={redo}>
          {t("lesson.redo")}
        </Button>
      )}
      {todo.length > 0 && (
        <ul className="divide-y rounded-2xl border bg-card">
          {todo.map((step) => {
            const state = stepState(step, lesson, results, done);
            const exercise =
              step.kind === "exercise" ? lesson.pages[step.index]?.exercise : undefined;
            const r = exercise && results[exercise.key];
            const scored = Object.values(r?.first ?? {}).filter((o) => o.result !== "unscored");
            return (
              <li key={stepId(step)}>
                <button
                  type="button"
                  onClick={() => go(stepId(step))}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent"
                >
                  <StepDot
                    state={state === "done" && step.kind !== "exercise" ? "read" : state}
                    label={step.kind === "exercise" ? step.index + 1 : "·"}
                  />
                  <span className="flex-1">{stepTitle(step, lesson, locale, t)}</span>
                  <span className="text-sm text-muted-foreground">
                    {!state
                      ? t("lesson.notDone")
                      : state === "skipped"
                        ? t("lesson.skipped")
                        : scored.length
                          ? `${scored.filter((o) => o.result === "correct").length}/${scored.length}`
                          : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Link
          to="/course/$series/$course"
          params={{ series, course }}
          className="inline-flex min-h-11 items-center rounded-xl border px-4 font-medium hover:bg-accent"
        >
          {t("lesson.backToCourse")}
        </Link>
        {nextLesson && (
          <Link
            to="/lesson/$series/$course/$lesson"
            params={{ series, course, lesson: parseLessonKey(nextLesson).name }}
            className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 font-semibold text-primary-foreground hover:bg-primary/90"
          >
            {t("lesson.nextLesson")} →
          </Link>
        )}
      </div>
    </section>
  );
}
