// The lesson plan (09): its steps in order — overview, words, grammar, exercises, culture, AI practice,
// summary — each with its state in the run, under the labels of their sections. Shown beside the lesson
// on wide screens and in a sheet on phones; the reference opens from the lesson's header.
import {
  type ExerciseResult,
  exerciseMark,
  type LessonStep,
  stepId,
  stepState,
} from "@sprachanker/engine";
import type { Lesson, LocaleLesson, StepId } from "@sprachanker/schema";
import {
  BookOpen,
  Globe,
  Headphones,
  Layers,
  MessagesSquare,
  PenLine,
  Play,
  SearchCheck,
  Star,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { PlanHeading, PlanNav, PlanRow } from "@/ui/plan-list.tsx";
import { StepDot } from "@/ui/step-dot.tsx";
import { pageTitle } from "./reference.tsx";

/** A step's title in the plan. */
/** A lesson's words as its Words step makes cards of them: one per word (two entries of one word,
 *  "sich trauen" and "sich (etwas) trauen", are one). Pure. */
export const wordCount = (lesson: Lesson) => new Set(lesson.vocab.map((v) => v.lexeme)).size;

/** A step's mark in the plan and the summary alike: an exercise's (partly right included, as
 *  everywhere), a page read or a step done besides the exercises "read". */
export function stepMark(
  step: LessonStep,
  lesson: Lesson,
  results: Record<string, ExerciseResult>,
  done: Map<StepId, "done" | "skipped">,
) {
  if (step.kind === "exercise") {
    const exercise = lesson.pages[step.index]?.exercise;
    return exercise && exerciseMark(exercise, results[exercise.key]);
  }
  const state = stepState(step, lesson, results, done);
  return state === "done" ? ("read" as const) : state;
}

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
      return (page && pageTitle(page, t)) || t(`lesson.step.${step.kind}`);
    }
    case "words":
      return t("lesson.step.wordsCount", { count: wordCount(lesson) });
    default:
      return t(`lesson.step.${step.kind}`);
  }
}

const ICON: Partial<Record<LessonStep["kind"], React.ComponentType<{ className?: string }>>> = {
  overview: Play,
  words: Layers,
  grammar: BookOpen,
  culture: Globe,
  understanding: Headphones,
  writing: PenLine,
  scene: MessagesSquare,
  mistakes: SearchCheck,
  summary: Star,
};

/** The section a step starts, if it is the first of its kind: grammar, exercises, culture, practice. */
const SECTION: Partial<Record<LessonStep["kind"], string>> = {
  grammar: "lesson.section.grammar",
  exercise: "lesson.section.exercises",
  culture: "lesson.section.culture",
  understanding: "lesson.section.practice",
  writing: "lesson.section.practice",
  scene: "lesson.section.practice",
  mistakes: "lesson.section.practice",
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
    <PlanNav current={current}>
      {steps.map((step) => {
        const id = stepId(step);
        const Icon = ICON[step.kind];
        const label = SECTION[step.kind];
        const header = label && label !== section ? label : undefined;
        section = label ?? (step.kind === "summary" ? undefined : section);
        return (
          <div key={id}>
            {header && <PlanHeading>{t(header)}</PlanHeading>}
            <PlanRow
              current={current === id}
              onClick={() => go(id)}
              mark={
                <StepDot
                  state={
                    stepMark(step, lesson, results, done) ??
                    (current === id && step.kind === "exercise" ? "current" : undefined)
                  }
                  label={
                    step.kind === "exercise" ? (
                      step.index + 1
                    ) : Icon ? (
                      <Icon className="size-3" />
                    ) : null
                  }
                />
              }
            >
              <span className="leading-snug">{stepTitle(step, lesson, locale, t)}</span>
            </PlanRow>
          </div>
        );
      })}
    </PlanNav>
  );
}
