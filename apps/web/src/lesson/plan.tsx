// The lesson plan (09): overview, the exercises with their state in the run, summary, and the
// reference tabs. Shown beside the lesson on wide screens and in a sheet on phones.
import { type ExerciseResult, type ExerciseState, exerciseState } from "@sprachanker/engine";
import type { Lesson, LocaleLesson } from "@sprachanker/schema";
import { BookOpenText, Check, Play, SkipForward, Star, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/ui/utils.ts";
import { type ReferenceTab, referenceTabs } from "./reference.tsx";

export type Step = "overview" | number | "summary";

/** An exercise's mark in the plan and the summary: right (green ✓), with mistakes (red ✕), answered
 *  without a score (grey ✓), skipped (dashed ⏭), the current one (yellow ring), else its number. */
export function StepDot({
  state,
  label,
}: {
  state?: ExerciseState | "current";
  label: React.ReactNode;
}) {
  const { t } = useTranslation();
  const worked = state && state !== "current";
  return (
    <span
      title={worked ? t(`lesson.state.${state}`) : undefined}
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-full border-2 text-xs font-semibold",
        state === "correct" && "border-correct bg-correct text-white",
        state === "wrong" && "border-wrong bg-wrong text-white",
        state === "done" && "border-muted-foreground/60 bg-muted text-muted-foreground",
        state === "skipped" && "border-dashed border-muted-foreground/60 text-muted-foreground",
        state === "current" && "border-primary",
      )}
    >
      {state === "correct" || state === "done" ? (
        <Check className="size-3.5" />
      ) : state === "wrong" ? (
        <X className="size-3.5" />
      ) : state === "skipped" ? (
        <SkipForward className="size-3" />
      ) : (
        label
      )}
      {worked && <span className="sr-only">{t(`lesson.state.${state}`)}</span>}
    </span>
  );
}

export function Plan({
  lesson,
  locale,
  step,
  results,
  go,
  openReference,
}: {
  lesson: Lesson;
  locale: LocaleLesson | null;
  step: Step;
  results: Record<string, ExerciseResult>;
  go(step: Step): void;
  openReference(tab: ReferenceTab): void;
}) {
  const { t } = useTranslation();
  const tabs = referenceTabs(lesson, locale);
  const row = (target: Step, dot: React.ReactNode, label: string) => (
    <button
      type="button"
      key={String(target)}
      onClick={() => go(target)}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left text-[15px] hover:bg-accent",
        step === target && "bg-accent font-semibold",
      )}
    >
      {dot}
      <span className="leading-snug">{label}</span>
    </button>
  );
  return (
    <nav className="space-y-0.5">
      {row("overview", <StepDot label={<Play className="size-3" />} />, t("lesson.overview"))}
      {lesson.pages.map(({ exercise }, i) =>
        row(
          i,
          <StepDot
            state={
              exerciseState(exercise, results[exercise.key]) ?? (step === i ? "current" : undefined)
            }
            label={i + 1}
          />,
          locale?.exercises[exercise.key]?.title ?? exercise.key,
        ),
      )}
      {row("summary", <StepDot label={<Star className="size-3" />} />, t("lesson.summary"))}
      {!!tabs.length && (
        <div className="mt-4 border-t pt-3">
          <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("lesson.reference")}
          </p>
          {tabs.map((tab) => (
            <button
              type="button"
              key={tab}
              onClick={() => openReference(tab)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[15px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <BookOpenText className="size-4" /> {t(`ref.${tab}`)}
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}
