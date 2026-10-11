// One exercise on its own screen: answer, check (instant, same engine as the server), feedback, next.
// "Check" opens once every item is answered and every recording has been played (use-exercise.ts);
// a checked item's card takes the result's colour on its left edge, with its own controls beside it: why
// wrong, answer again, and the item's earlier attempts in every pass (the Notebook's item history).
import { spokenFreely } from "@sprachanker/engine";
import type { Exercise, LocaleExercise } from "@sprachanker/schema";
import { History, RotateCcw, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ItemCard, SharedPrompt, severalNote, sharedPrompt } from "@/exercises/item-card.tsx";
import { ItemHistory } from "@/library/item-history.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/components/tooltip.tsx";
import { CourseHtml } from "@/ui/course-html.tsx";
import { MediaBlock } from "@/ui/media.tsx";
import { useRequiredTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { useEnterKey } from "./enter-key.ts";
import { StepBar, StepHeader } from "./steps.tsx";
import { type Answered, useExercise } from "./use-exercise.ts";
import type { ExerciseResult } from "./use-run.ts";

/** The items' column · their controls; the exercise's own media and texts sit in the same column. On a
 *  phone the controls go in a row under the card, so the card has the width. */
const ITEM_GRID = "grid grid-cols-[minmax(0,1fr)] gap-x-2 sm:grid-cols-[minmax(0,1fr)_2.25rem]";

/** An item's control: an icon button with its name shown on hover and focus. */
function ItemControl({
  label,
  onClick,
  pressed,
  children,
}: {
  label: string;
  onClick(): void;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
          className={cn(
            "size-9 text-muted-foreground pointer-coarse:size-11",
            pressed && "bg-accent text-foreground",
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}

interface StepProps {
  exercise: Exercise;
  locale?: LocaleExercise;
  index: number;
  total: number;
  /** The summary comes next (the main button says so). */
  last?: boolean;
  url(p: string): string;
  /** What the run already has for this exercise: shown again when it is reopened. */
  stored?: ExerciseResult;
  /** A finished run is shown read-only: no checking, no new answers. */
  readOnly?: boolean;
  /** Given answers with their local outcomes, and the items left without an answer. */
  onAnswered: Answered;
  onBack(): void;
  onNext(): void;
  /** Help with a wrong item (the LLM explanation), if available: shown under it when asked for. */
  explain?(index: number, answer: unknown): React.ReactNode;
  /** An answer said aloud without a phrase to say, as heard (the LLM's check), if available. */
  spoken?(index: number, transcript: string): React.ReactNode;
}

export function ExerciseStep({
  exercise,
  locale,
  index,
  total,
  last = index + 1 === total,
  url,
  stored,
  readOnly = false,
  onAnswered,
  onBack,
  onNext,
  explain,
  spoken,
}: StepProps) {
  const lang = useRequiredTargetLang();
  const { t } = useTranslation();
  const ex = useExercise({ exercise, stored, readOnly, lang, onAnswered });
  const { answers, outcomes, checking, waiting } = ex;
  const primary = () => {
    if (checking) return ex.check();
    ex.leave();
    onNext();
  };
  const article = useRef<HTMLElement>(null);
  useEnterKey(article, primary);
  /** The item whose earlier attempts are open (the Notebook's item history). */
  const [history, setHistory] = useState<string>();
  const promptAbove = !!sharedPrompt(exercise, locale);
  const several = severalNote(exercise, locale);

  return (
    // At least a screen tall, so the action bar sits at the bottom even under a short exercise.
    <article ref={article} className="flex min-h-[calc(100dvh-8rem)] flex-col gap-4">
      <StepHeader
        label={t("lesson.exerciseOf", { n: index + 1, total })}
        title={locale?.title || t("lesson.exerciseN", { n: index + 1 })}
      >
        {locale?.instructionHtml && (
          <CourseHtml className="mt-2 text-lg" html={locale.instructionHtml} />
        )}
      </StepHeader>
      {/* The exercise's own picture, recording and texts in the items' column. */}
      {(exercise.media || exercise.text || locale?.textHtml) && (
        <div className={ITEM_GRID}>
          <div className="col-start-1 space-y-4">
            <MediaBlock
              key={ex.round}
              media={exercise.media}
              url={url}
              audioLabel={t("lesson.exerciseOf", { n: index + 1, total })}
              onHeard={() => ex.hear("exercise")}
            />
            {exercise.text && (
              <p lang={lang} className="text-lg">
                {exercise.text}
              </p>
            )}
            {locale?.textHtml && (
              <CourseHtml className="rounded-xl bg-muted px-4 py-2" html={locale.textHtml} />
            )}
          </div>
        </div>
      )}
      {/* A prompt every item has alike, once above them (not repeated in each card). */}
      {(promptAbove || several === "show") && (
        <div className={ITEM_GRID}>
          <SharedPrompt exercise={exercise} locale={locale} className="col-start-1" />
        </div>
      )}
      <ol aria-label={t("lesson.itemsList")} className="space-y-6 pb-2">
        {exercise.items.map((item, i) => {
          const outcome = outcomes?.[i];
          const marked = outcome && outcome.result !== "unscored";
          const right = outcome?.result === "correct";
          const said = spoken && spokenFreely(exercise, i, answers[i]);
          return (
            // Card · controls: the card keeps its size when checked; only an explanation asked
            // for adds a panel under it.
            <li
              key={ex.cardKey(i)}
              className={ITEM_GRID}
              onPointerDown={() => ex.touch(i)}
              onFocus={() => ex.touch(i)}
            >
              <ItemCard
                exercise={exercise}
                locale={locale}
                index={i}
                answer={answers[i]}
                outcome={outcome}
                url={url}
                onAnswer={(a: unknown) => ex.answer(i, a)}
                active={i === ex.activeItem && !readOnly}
                heard={readOnly || ex.itemHeard(i)}
                onHeard={() => ex.hear(`item-${i}`)}
                promptAbove={promptAbove}
                severalAbove={!!several}
              />
              <div className="col-start-1 flex gap-1.5 pt-2 empty:hidden sm:col-start-2 sm:flex-col">
                {marked && !right && explain && (
                  <ItemControl
                    label={t("lesson.why")}
                    pressed={ex.explaining.has(i)}
                    onClick={() => ex.toggleExplain(i)}
                  >
                    <Sparkles className="size-4" />
                  </ItemControl>
                )}
                {marked && !readOnly && (
                  <ItemControl label={t("lesson.answerAgain")} onClick={() => ex.answerAgain(i)}>
                    <RotateCcw className="size-4" />
                  </ItemControl>
                )}
                {marked && (
                  <ItemControl
                    label={t("notebook.itemHistory")}
                    onClick={() => setHistory(item.key)}
                  >
                    <History className="size-4" />
                  </ItemControl>
                )}
              </div>
              {ex.explaining.has(i) && explain && (
                <div className="col-start-1">{explain(i, answers[i])}</div>
              )}
              {said && <div className="col-start-1">{spoken(i, said)}</div>}
            </li>
          );
        })}
      </ol>
      {/* The action bar: at the bottom of the screen, its buttons always in the same places — the main one
          (Check, then Next) on the right, at least a fixed width, under the finger or cursor. */}
      <StepBar
        onBack={onBack}
        onNext={primary}
        next={checking ? t("lesson.check") : last ? t("lesson.toSummary") : t("lesson.next")}
        nextDisabled={checking && !ex.canCheck}
        // What Check is waiting for.
        note={
          waiting?.for === "answers"
            ? t("lesson.answerAll", { done: waiting.done, total: waiting.total })
            : waiting?.for === "exercise recording"
              ? t("lesson.listenFirst")
              : waiting && t("lesson.listenItem", { n: waiting.n })
        }
        onSkip={
          checking && !outcomes
            ? () => {
                ex.skip();
                onNext();
              }
            : undefined
        }
        extra={
          outcomes &&
          !readOnly && (
            <Button
              variant="outline"
              size="lg"
              className="max-sm:px-3"
              onClick={() => {
                ex.retry();
                // Begun again from the top: the exercise's text and its first item.
                window.scrollTo({ top: 0 });
              }}
            >
              {t("lesson.retry")}
            </Button>
          )
        }
      />
      <ItemHistory
        itemKey={history}
        exercise={{ exercise, locale: locale ?? null }}
        url={url}
        onClose={() => setHistory(undefined)}
      />
    </article>
  );
}
