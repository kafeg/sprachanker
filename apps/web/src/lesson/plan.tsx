// The lesson plan (09): its steps in order — overview, words, grammar, exercises, culture, AI practice,
// summary — each with its state in the run, under the labels of their sections. Shown beside the lesson
// on wide screens and in a sheet on phones; the reference opens from the lesson's header.
import {
  type ExerciseResult,
  type ExerciseState,
  type LessonStep,
  stepId,
  stepState,
} from "@sprachanker/engine";
import type { Lesson, LocaleLesson, StepId } from "@sprachanker/schema";
import {
  BookOpen,
  Check,
  ClipboardList,
  Drama,
  Globe,
  Layers,
  PenLine,
  Play,
  SkipForward,
  Star,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/ui/utils.ts";
import { pageTitle } from "./reference.tsx";

/** An exercise's mark in the plan and the summary: right (green ✓), with mistakes (red ✕), answered
 *  without a score (grey ✓), skipped (dashed ⏭), the current one (yellow ring), else its number. */
export function StepDot({
  state,
  label,
}: {
  /** An exercise's state, a step besides exercises done ("read"), or the current exercise. */
  state?: ExerciseState | "read" | "current";
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
        state === "read" && "border-correct text-correct",
        state === "current" && "border-primary",
      )}
    >
      {state === "correct" || state === "done" || state === "read" ? (
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

/** A step's title in the plan. */
export function stepTitle(
  step: LessonStep,
  lesson: Lesson,
  locale: LocaleLesson | null,
  t: (key: string, values?: Record<string, unknown>) => string,
): string {
  switch (step.kind) {
    case "exercise": {
      const exercise = lesson.pages[step.index]?.exercise;
      return (
        (exercise && locale?.exercises[exercise.key]?.title) ||
        t("lesson.exerciseN", { n: step.index + 1 })
      );
    }
    case "grammar":
    case "culture": {
      const page = locale?.tabs[step.kind][step.index];
      return page ? pageTitle(page, t) : t(`lesson.step.${step.kind}`);
    }
    case "words":
      return t("lesson.step.wordsCount", { count: lesson.vocab.length });
    default:
      return t(`lesson.step.${step.kind}`);
  }
}

const ICON: Partial<Record<LessonStep["kind"], React.ComponentType<{ className?: string }>>> = {
  overview: Play,
  words: Layers,
  grammar: BookOpen,
  culture: Globe,
  writing: PenLine,
  scene: Drama,
  review: ClipboardList,
  summary: Star,
};

/** The section a step starts, if it is the first of its kind: grammar, exercises, culture, practice. */
const SECTION: Partial<Record<LessonStep["kind"], string>> = {
  grammar: "lesson.section.grammar",
  exercise: "lesson.section.exercises",
  culture: "lesson.section.culture",
  writing: "lesson.section.practice",
  scene: "lesson.section.practice",
  review: "lesson.section.practice",
};

export function Plan({
  lesson,
  locale,
  steps,
  current,
  results,
  done,
  go,
}: {
  lesson: Lesson;
  locale: LocaleLesson | null;
  steps: LessonStep[];
  /** Id of the step on screen. */
  current: string;
  results: Record<string, ExerciseResult>;
  done: Map<StepId, "done" | "skipped">;
  go(id: string): void;
}) {
  const { t } = useTranslation();
  let section: string | undefined;
  return (
    <nav className="space-y-0.5">
      {steps.map((step) => {
        const id = stepId(step);
        const state = stepState(step, lesson, results, done);
        const Icon = ICON[step.kind];
        const label = SECTION[step.kind];
        const header = label && label !== section ? label : undefined;
        section = label ?? (step.kind === "summary" ? undefined : section);
        return (
          <div key={id}>
            {header && (
              <p className="px-2 pt-3 pb-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t(header)}
              </p>
            )}
            <button
              type="button"
              onClick={() => go(id)}
              aria-current={current === id ? "step" : undefined}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left text-[15px] hover:bg-accent",
                current === id && "bg-accent font-semibold",
              )}
            >
              <StepDot
                state={
                  state === "done" && step.kind !== "exercise"
                    ? "read"
                    : (state ??
                      (current === id && step.kind === "exercise" ? "current" : undefined))
                }
                label={
                  step.kind === "exercise" ? (
                    step.index + 1
                  ) : Icon ? (
                    <Icon className="size-3" />
                  ) : null
                }
              />
              <span className="leading-snug">{stepTitle(step, lesson, locale, t)}</span>
            </button>
          </div>
        );
      })}
    </nav>
  );
}
