// One exercise on its own screen: answer, check (instant, same engine as the server), feedback, next.
// "Check" opens once every item is answered and every recording has been played (use-exercise.ts);
// checked items are marked on a rail left of their card, with their own controls on the right: why
// wrong, answer again, and the item's earlier attempts in every pass (the Notebook's item history).
import { spokenFreely } from "@sprachanker/engine";
import type { Exercise, LocaleExercise, Outcome } from "@sprachanker/schema";
import { Check, History, RotateCcw, Sparkles, X } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ItemCard } from "@/exercises/item-card.tsx";
import { ItemHistory } from "@/notebook/item-history.tsx";
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

/** Rail (an item's mark once checked) · the items' column · controls; the exercise's own media and
 *  texts sit in the same column. */
const ITEM_GRID = "grid grid-cols-[1.5rem_minmax(0,1fr)_2.25rem] gap-x-2";

/** A checked item's mark on the rail left of its card: ✓ right, ✕ wrong or partly right (no button). */
function ItemRail({ outcome }: { outcome: Outcome }) {
  const { t } = useTranslation();
  const ok = outcome.result === "correct";
  const label = t(
    ok ? "lesson.correct" : outcome.result === "partial" ? "lesson.partial" : "lesson.wrong",
  );
  return (
    <div className="flex h-full flex-col items-center gap-1.5 pt-3">
      <span
        role="status"
        title={label}
        className={cn(
          "grid size-6 place-items-center rounded-full text-white",
          ok ? "bg-correct" : "bg-wrong",
        )}
      >
        {ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}
        <span className="sr-only">{label}</span>
      </span>
      <span className={cn("w-1 flex-1 rounded-full", ok ? "bg-correct" : "bg-wrong")} />
    </div>
  );
}

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
          className={cn("size-9 text-muted-foreground", pressed && "bg-accent text-foreground")}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}

export interface StepProps {
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
          <div className="col-start-2 space-y-4">
            <MediaBlock
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
      <ol className="space-y-6 pb-2">
        {exercise.items.map((item, i) => {
          const outcome = outcomes?.[i];
          const marked = outcome && outcome.result !== "unscored";
          const right = outcome?.result === "correct";
          const said = spoken && spokenFreely(exercise, i, answers[i]);
          return (
            // Rail (status) · card · controls: the card keeps its size when checked; only an
            // explanation asked for adds a panel under it.
            <li
              key={item.key}
              className={ITEM_GRID}
              onPointerDown={() => ex.touch(i)}
              onFocus={() => ex.touch(i)}
            >
              <div className="h-full">{marked && <ItemRail outcome={outcome} />}</div>
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
              />
              <div className="flex flex-col gap-1.5 pt-2">
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
                <div className="col-start-2">{explain(i, answers[i])}</div>
              )}
              {said && <div className="col-start-2">{spoken(i, said)}</div>}
            </li>
          );
        })}
      </ol>
      {/* The action bar: at the bottom of the screen, its buttons always in the same places — the main one
          (Check, then Next) on the right with a fixed width, under the finger or cursor. */}
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
            <Button variant="outline" size="lg" onClick={ex.retry}>
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
