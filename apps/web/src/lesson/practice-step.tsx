// An AI practice step of the plan (09): writing, a scene, or going over mistakes — the page an optional
// feature fills through the player's slot (the mistakes step shows the run's own status first), with
// the step bar; a step done can no longer be skipped.

import type { LessonStep, PracticeKind } from "@sprachanker/engine";
import type { Lesson, LocaleLesson } from "@sprachanker/schema";
import { useTranslation } from "react-i18next";
import { MistakesStatus } from "./mistakes-status.tsx";
import { stepTitle } from "./plan.tsx";
import type { LessonSlotContext, LessonSlots } from "./slots.ts";
import { StepBar, StepHeader } from "./steps.tsx";
import type { useRun } from "./use-run.ts";

export function PracticeStep({
  kind,
  lesson,
  locale,
  run,
  slots,
  context,
  go,
  mark,
  onBack,
  onNext,
}: {
  kind: PracticeKind;
  lesson: Lesson;
  locale: LocaleLesson | null;
  run: ReturnType<typeof useRun>;
  slots: LessonSlots;
  context: LessonSlotContext;
  go(id: string): void;
  mark(id: string, skipped?: boolean): void;
  onBack(): void;
  onNext(): void;
}) {
  const { t } = useTranslation();
  const done = run.done.get(kind) === "done";
  return (
    <article className="flex min-h-[calc(100dvh-8rem)] flex-col gap-4">
      <StepHeader
        label={t("lesson.section.practice")}
        title={stepTitle({ kind } as LessonStep, lesson, locale, t)}
      />
      {kind === "mistakes" && (
        <MistakesStatus
          lesson={lesson}
          locale={locale}
          results={run.results}
          mistakes={run.mistakes}
          go={go}
        />
      )}
      {slots.practice?.step(kind, {
        ...context,
        onDone: () => mark(kind),
        onStored: run.retry,
      })}
      <StepBar
        onBack={onBack}
        onNext={onNext}
        onSkip={
          done
            ? undefined
            : () => {
                mark(kind, true);
                onNext();
              }
        }
      />
    </article>
  );
}
