// The lesson summary: the run's score, what is left while it is open, every step of the plan with
// its state (exercises with their right answers), and the way on.
import {
  type ExerciseResult,
  firstAttempts,
  firstTry,
  type LessonStep,
  type PracticeKind,
  planCoverage,
  stepId,
  stepState,
} from "@sprachanker/engine";
import type { Lesson, LessonResult, LocaleLesson, StepId } from "@sprachanker/schema";
import { parseLessonKey } from "@sprachanker/schema";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/button.tsx";
import { usePercent } from "@/ui/format.ts";
import { ListRow } from "@/ui/history.tsx";
import { panelClass } from "@/ui/panel.tsx";
import { StepDot } from "@/ui/step-dot.tsx";
import { cn } from "@/ui/utils.ts";
import { type PracticeMarks, stepMark, stepTitle } from "./plan.tsx";
import { StepHeader } from "./steps.tsx";

export function LessonSummary({
  series,
  course,
  lesson,
  locale,
  steps,
  results,
  done,
  practice,
  result,
  mode,
  nextLesson,
  go,
  redo,
  mistakes,
}: {
  series: string;
  course: string;
  lesson: Lesson;
  locale: LocaleLesson | null;
  steps: LessonStep[];
  results: Record<string, ExerciseResult>;
  done: Map<StepId, "done" | "skipped">;
  practice: PracticeMarks;
  /** Going over the run's mistakes, where it has some (a slot: nothing where no assistant works). */
  mistakes?: React.ReactNode;
  /** Score of the run shown, once it is finished. */
  result: LessonResult | null | undefined;
  /** The run shown: still open (what is left is listed), finished (can be done again), or none. */
  mode: "none" | "active" | "finished";
  nextLesson?: string;
  go(id: string): void;
  redo(): void;
}) {
  const { t } = useTranslation();
  const percent = usePercent();
  const coverage = planCoverage(steps, lesson, results, done);
  // Items right at the first attempt (the score itself also weighs partial answers).
  const first = firstAttempts(lesson, results);
  const todo = steps.filter((s) => s.kind !== "overview" && s.kind !== "summary");
  return (
    <section className="space-y-6">
      <StepHeader label={t("lesson.summary")} title={locale?.title} />
      {/* The score once something is scored; before that, no placeholder. */}
      {lesson.pages.length > 0 && result && (
        <div className="flex items-end gap-4">
          <span className="font-heading text-6xl font-bold">{percent(result.score)}</span>
          <span className="pb-2 text-muted-foreground">
            {t("lesson.score", { correct: first.correct, scored: first.scored })}
          </span>
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
        <ul className={cn(panelClass, "divide-y overflow-hidden")}>
          {todo.map((step) => {
            const state = stepState(step, lesson, results, done);
            const exercise =
              step.kind === "exercise" ? lesson.pages[step.index]?.exercise : undefined;
            // Right at the first try of the items checked (a skipped one counted), as the Notebook.
            const first = exercise && firstTry(exercise, results[exercise.key]);
            const worked = practice.get(step.kind as PracticeKind);
            const mark = stepMark(step, lesson, results, done, practice);
            return (
              <li key={stepId(step)}>
                <ListRow chevron={false} flush onClick={() => go(stepId(step))}>
                  <StepDot state={mark} label={step.kind === "exercise" ? step.index + 1 : "·"} />
                  <span className="flex-1">{stepTitle(step, lesson, locale, t)}</span>
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {!state
                      ? t("lesson.notDone")
                      : first?.scored
                        ? `${first.correct}/${first.scored}`
                        : worked?.of
                          ? `${worked.right}/${worked.of}`
                          : t(`lesson.state.${mark}`)}
                  </span>
                </ListRow>
              </li>
            );
          })}
        </ul>
      )}
      {mistakes}
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="lg">
          <Link to="/course/$series/$course" params={{ series, course }}>
            {t("lesson.backToCourse")}
          </Link>
        </Button>
        {nextLesson && (
          <Button asChild size="lg">
            <Link
              to="/lesson/$series/$course/$lesson"
              params={{ series, course, lesson: parseLessonKey(nextLesson).name }}
            >
              {t("lesson.nextLesson")} <ArrowRight className="rtl:-scale-x-100 size-4" />
            </Link>
          </Button>
        )}
      </div>
    </section>
  );
}
