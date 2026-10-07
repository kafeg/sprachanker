// The run at a glance for "Going over mistakes" (09): exercises worked, scored items right at the first
// attempt, and the mistakes by exercise — counted by the app from the run, no model involved. A row
// opens its exercise; the tutor's walk-through follows on the step page.
import {
  type ExerciseResult,
  firstAttempts,
  lessonCoverage,
  type Mistake,
} from "@sprachanker/engine";
import type { Lesson, LocaleLesson } from "@sprachanker/schema";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { StepDot, stepTitle } from "./plan.tsx";

export function MistakesStatus({
  lesson,
  locale,
  results,
  mistakes,
  go,
}: {
  lesson: Lesson;
  locale: LocaleLesson | null;
  results: Record<string, ExerciseResult>;
  mistakes: Mistake[];
  go(id: string): void;
}) {
  const { t } = useTranslation();
  const coverage = lessonCoverage(lesson, results);
  const first = firstAttempts(lesson, results);
  // In the order of the lesson, each item once (mistakes come newest first).
  const byExercise = lesson.pages.flatMap(({ exercise }, index) => {
    const here = mistakes
      .filter((m) => m.exerciseKey === exercise.key)
      .sort((a, b) => a.index - b.index);
    return here.length ? [{ index, here }] : [];
  });

  return (
    <div className="space-y-4 rounded-2xl border bg-card p-5">
      <dl className="grid grid-cols-2 gap-4">
        <div>
          <dt className="text-sm text-muted-foreground">{t("mistakes.exercises")}</dt>
          <dd className="text-2xl font-bold tabular-nums">
            {t("mistakes.ofTotal", { n: coverage.worked, total: coverage.total })}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">{t("mistakes.firstTry")}</dt>
          <dd className="text-2xl font-bold tabular-nums">
            {first.scored ? t("mistakes.ofTotal", { n: first.correct, total: first.scored }) : "—"}
          </dd>
        </div>
      </dl>
      {byExercise.length > 0 ? (
        <div>
          <h3 className="mb-1 font-semibold">{t("mistakes.list")}</h3>
          <ul className="divide-y">
            {byExercise.map(({ index, here }) => {
              const fixed = here.filter((m) => m.fixed).length;
              return (
                <li key={index}>
                  <button
                    type="button"
                    onClick={() => go(`exercise:${index}`)}
                    className="flex w-full items-center gap-3 rounded-lg px-1 py-2 text-left hover:bg-accent pointer-coarse:min-h-11"
                  >
                    <StepDot state="wrong" label={index + 1} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">
                        {stepTitle({ kind: "exercise", index }, lesson, locale, t)}
                      </span>
                      <span className="block text-sm text-muted-foreground">
                        {t("mistakes.items", {
                          count: here.length,
                          items: here.map((m) => m.index + 1).join(", "),
                        })}
                        {fixed > 0 && ` · ${t("mistakes.fixed", { count: fixed })}`}
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="text-muted-foreground">
          {first.answered ? t("mistakes.none") : t("mistakes.notYet")}
        </p>
      )}
    </div>
  );
}
