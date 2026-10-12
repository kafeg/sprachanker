// An AI practice step of the plan: Reading, Listening, Writing or Speaking — the page an optional
// feature fills through the player's slot, with the step bar, whose main button the page may take while
// it needs it (Check, as an exercise's); a step done can no longer be skipped.

import type { LessonStep, PracticeKind } from "@sprachanker/engine";
import type { Lesson, LocaleLesson } from "@sprachanker/schema";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { stepTitle } from "./plan.tsx";
import type { LessonSlotContext, LessonSlots, PracticePrimary } from "./slots.ts";
import { StepBar, StepHeader } from "./steps.tsx";
import type { useRun } from "./use-run.ts";

export function PracticeStep({
  kind,
  lesson,
  locale,
  run,
  slots,
  context,
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
  mark(id: string, skipped?: boolean): void;
  onBack(): void;
  onNext(): void;
}) {
  const { t } = useTranslation();
  const done = run.done.get(kind) === "done";
  const worked = run.practice.has(kind);
  /** The page's own main button while it needs one (Check), else Next. */
  const [primary, setPrimary] = useState<PracticePrimary | null>(null);
  // Worked in the run but not recorded (the reply to its last answer lost, a reload): done now.
  useEffect(() => {
    if (worked && !done) mark(kind);
  }, [worked, done, kind, mark]);
  // Nothing worked yet: Check, waiting for the page (a text to answer, a task to say), as an
  // exercise's before its answers — never Next; Skip passes it by.
  const main =
    primary ??
    (done || worked ? null : { label: t("lesson.check"), disabled: true, run: () => {} });
  return (
    <article className="flex min-h-[calc(100dvh-8rem)] flex-col gap-4">
      <StepHeader
        label={t("lesson.section.practice")}
        title={stepTitle({ kind } as LessonStep, lesson, locale, t)}
      />
      {slots.practice?.step(kind, {
        ...context,
        // Done: the run read again, so the plan marks how it went (the check is kept in it).
        onDone: () => {
          mark(kind);
          void run.retry();
        },
        onStored: run.retry,
        setPrimary,
      })}
      <StepBar
        onBack={onBack}
        onNext={main ? main.run : onNext}
        next={main?.label}
        nextDisabled={main?.disabled}
        note={main?.note}
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
