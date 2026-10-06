// The lesson summary (09): the run's score, what is left while it is open, each exercise with its
// state, the new words, and the way on. Optional features add their part under the score.
import { type ExerciseResult, exerciseState, lessonCoverage } from "@sprachanker/engine";
import type { Lesson, LessonResult, LocaleLesson } from "@sprachanker/schema";
import { parseLessonKey } from "@sprachanker/schema";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/button.tsx";
import { type Step, StepDot } from "./plan.tsx";
import { VocabularyList } from "./reference.tsx";

export function LessonSummary({
  series,
  course,
  lesson,
  locale,
  url,
  results,
  result,
  mode,
  nextLesson,
  extra,
  go,
  redo,
}: {
  series: string;
  course: string;
  lesson: Lesson;
  locale: LocaleLesson | null;
  url(path: string): string;
  results: Record<string, ExerciseResult>;
  /** Score of the run shown, once it is finished. */
  result: LessonResult | null | undefined;
  /** The run shown: still open (what is left is listed), finished (can be done again), or none. */
  mode: "none" | "active" | "finished";
  nextLesson?: string;
  /** What optional features add under the score. */
  extra?: React.ReactNode;
  go(step: Step): void;
  redo(): void;
}) {
  const { t, i18n } = useTranslation();
  const total = lesson.pages.length;
  const coverage = lessonCoverage(lesson, results);
  // Items right at the first attempt (the score itself also weighs partial answers).
  const firstCorrect = Object.values(results)
    .flatMap((r) => Object.values(r.first))
    .filter((o) => o.result === "correct").length;
  return (
    <section className="space-y-6">
      <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        {t("lesson.summary")}
      </p>
      <h1 className="text-4xl font-bold">{locale?.title}</h1>
      {total > 0 && (
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
          <p>{t("lesson.left", { count: total - coverage.worked })}</p>
          <Button size="lg" onClick={() => go(coverage.firstLeft as number)}>
            {t("lesson.toExercise", { n: coverage.firstLeft + 1 })}
          </Button>
        </div>
      )}
      {mode === "finished" && (
        <Button size="lg" onClick={redo}>
          {t("lesson.redo")}
        </Button>
      )}
      {extra}
      {total > 0 && (
        <ul className="divide-y rounded-2xl border bg-card">
          {lesson.pages.map(({ exercise }, i) => {
            const r = results[exercise.key];
            const state = exerciseState(exercise, r);
            const scored = Object.values(r?.first ?? {}).filter((o) => o.result !== "unscored");
            return (
              <li key={exercise.key}>
                <button
                  type="button"
                  onClick={() => go(i)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent"
                >
                  <StepDot state={state} label={i + 1} />
                  <span className="flex-1">{locale?.exercises[exercise.key]?.title}</span>
                  <span className="text-sm text-muted-foreground">
                    {!state
                      ? t("lesson.notDone")
                      : scored.length
                        ? `${scored.filter((o) => o.result === "correct").length}/${scored.length}`
                        : r && !Object.keys(r.last).length
                          ? t("lesson.skipped")
                          : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div>
        <h2 className="text-2xl font-bold">{t("lesson.newWords")}</h2>
        <p className="mb-2 text-sm text-muted-foreground">{t("lesson.newWordsHint")}</p>
        <VocabularyList lesson={lesson} locale={locale} url={url} />
      </div>
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
