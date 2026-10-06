// One exercise on its own screen: answer, check (instant, same engine as the server), feedback, next.
import { checkItem } from "@sprachanker/engine";
import type { Exercise, LocaleExercise, Outcome } from "@sprachanker/schema";
import { Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { correctAnswer, ExerciseItem, isScored } from "@/exercises/index.tsx";
import { Button } from "@/ui/components/button.tsx";
import { CourseHtml } from "@/ui/course-html.tsx";
import { AudioPlayer, MediaBlock } from "@/ui/media.tsx";
import { useRequiredTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import type { ExerciseResult } from "./use-run.ts";

/** A checked item's mark in its card's corner: ✓ right, ✕ wrong or partly right (not a button). */
function ItemMark({ outcome }: { outcome: Outcome }) {
  const { t } = useTranslation();
  const ok = outcome.result === "correct";
  const label = t(
    ok ? "lesson.correct" : outcome.result === "partial" ? "lesson.partial" : "lesson.wrong",
  );
  return (
    <span
      role="status"
      title={label}
      className={cn(
        "absolute top-3 right-3 grid size-6 place-items-center rounded-full text-white",
        ok ? "bg-correct" : "bg-wrong",
      )}
    >
      {ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}
      <span className="sr-only">{label}</span>
    </span>
  );
}

export interface StepProps {
  exercise: Exercise;
  locale?: LocaleExercise;
  index: number;
  total: number;
  url(p: string): string;
  /** What the run already has for this exercise: shown again when it is reopened. */
  stored?: ExerciseResult;
  /** A finished run is shown read-only: no checking, no new answers. */
  readOnly?: boolean;
  /** Given answers with their local outcomes, and the items left without an answer. */
  onAnswered(
    answers: Array<{ itemKey: string; answer: unknown; outcome: Outcome }>,
    skipped: string[],
    ms: number,
  ): void;
  onBack(): void;
  onNext(): void;
  /** Extra help under a wrong item (the LLM explanation), if available. */
  explain?(index: number, answer: unknown): React.ReactNode;
}

export function ExerciseStep({
  exercise,
  locale,
  index,
  total,
  url,
  stored,
  readOnly = false,
  onAnswered,
  onBack,
  onNext,
  explain,
}: StepProps) {
  const lang = useRequiredTargetLang();
  const { t } = useTranslation();
  const scored = isScored(exercise.type);
  // Reopened: the latest answers of the run and, for checked exercises, their outcomes.
  const [answers, setAnswers] = useState<Record<number, unknown>>(() =>
    Object.fromEntries(
      exercise.items.flatMap((item, i) =>
        stored?.last[item.key] ? [[i, stored.last[item.key]?.answer]] : [],
      ),
    ),
  );
  const [outcomes, setOutcomes] = useState<Record<number, Outcome> | undefined>(() => {
    const restored = exercise.items.flatMap((item, i) => {
      const outcome = stored?.last[item.key]?.outcome;
      return outcome ? [[i, outcome] as const] : [];
    });
    return scored && restored.length ? Object.fromEntries(restored) : undefined;
  });
  const shownAt = useRef(Date.now());
  const last = index + 1 === total;

  const check = () => {
    // Unanswered items show as wrong (with the right answer) but are recorded as skipped (04).
    const unanswered: Outcome = {
      result: "wrong",
      score: 0,
      ruleIds: exercise.ruleIds,
      lexemes: [],
    };
    const results = exercise.items.map((item, i) => {
      const answer = answers[i];
      return {
        itemKey: item.key,
        answer,
        outcome: answer === undefined ? unanswered : checkItem(exercise, i, answer, lang),
      };
    });
    setOutcomes(Object.fromEntries(results.map((r, i) => [i, r.outcome])));
    onAnswered(
      results.filter((r) => r.answer !== undefined),
      results.filter((r) => r.answer === undefined).map((r) => r.itemKey),
      Date.now() - shownAt.current,
    );
  };
  const next = () => {
    // Unscored exercises are recorded on leaving: the ratings given, the rest as skipped.
    if (!scored && !readOnly) {
      const rated: Array<{ itemKey: string; answer: unknown; outcome: Outcome }> = [];
      const skipped: string[] = [];
      exercise.items.forEach((item, i) => {
        if (answers[i] === undefined) {
          if (!stored?.skipped.includes(item.key)) skipped.push(item.key);
        } else if (answers[i] !== stored?.last[item.key]?.answer) {
          rated.push({
            itemKey: item.key,
            answer: answers[i],
            outcome: checkItem(exercise, i, answers[i], lang),
          });
        }
      });
      if (rated.length || skipped.length) onAnswered(rated, skipped, Date.now() - shownAt.current);
    }
    onNext();
  };
  const skip = () => {
    onAnswered(
      [],
      exercise.items.map((item) => item.key),
      Date.now() - shownAt.current,
    );
    onNext();
  };
  const retry = () => {
    setAnswers({});
    setOutcomes(undefined);
    shownAt.current = Date.now();
  };
  const primary = scored && !outcomes && !readOnly ? check : next;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        e.key !== "Enter" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "BUTTON" ||
        target.tagName === "SELECT"
      )
        return;
      e.preventDefault();
      primary();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    // At least a screen tall, so the action bar sits at the bottom even under a short exercise.
    <article className="flex min-h-[calc(100dvh-12rem)] flex-col gap-4 lg:min-h-[calc(100dvh-8rem)]">
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {t("lesson.exerciseOf", { n: index + 1, total })}
        </p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{locale?.title ?? exercise.key}</h1>
        {locale?.instructionHtml && (
          <CourseHtml className="mt-2 text-lg" html={locale.instructionHtml} />
        )}
      </div>
      <MediaBlock
        media={exercise.media}
        url={url}
        audioLabel={t("lesson.exerciseOf", { n: index + 1, total })}
      />
      {exercise.text && (
        <p lang={lang} className="text-lg">
          {exercise.text}
        </p>
      )}
      {locale?.textHtml && (
        <CourseHtml className="rounded-xl bg-muted px-4 py-2" html={locale.textHtml} />
      )}
      <ol className="space-y-6 pb-2">
        {exercise.items.map((item, i) => {
          const loc = locale?.items[`#${i + 1}`];
          const outcome = outcomes?.[i];
          const marked = outcome && outcome.result !== "unscored";
          const right = outcome?.result === "correct";
          const answer = marked && !right ? correctAnswer(exercise, i) : undefined;
          return (
            <li
              key={item.key}
              className={cn(
                "relative rounded-2xl border bg-card p-4 sm:p-5",
                marked && "rounded-l-md border-l-4 pr-12",
                marked && (right ? "border-l-correct" : "border-l-wrong"),
              )}
            >
              {marked && <ItemMark outcome={outcome} />}
              {item.media?.audio && (
                <AudioPlayer
                  compact
                  src={url(item.media.audio)}
                  label={item.prompt ?? t("lesson.itemAudio", { n: i + 1 })}
                  className="mb-3"
                />
              )}
              <div className="mb-3">
                {item.prompt && (
                  <p lang={lang} className="text-lg font-semibold">
                    {item.prompt}
                  </p>
                )}
                {loc?.prompt && <p className="text-lg font-semibold">{loc.prompt}</p>}
                {loc?.hintHtml && (
                  <CourseHtml className="text-sm text-muted-foreground" html={loc.hintHtml} />
                )}
              </div>
              {item.media && ("image" in item.media || "video" in item.media) && (
                <MediaBlock
                  media={{
                    image: "image" in item.media ? item.media.image : undefined,
                    video: "video" in item.media ? item.media.video : undefined,
                  }}
                  url={url}
                  audioLabel=""
                />
              )}
              <ExerciseItem
                type={exercise.type}
                item={item as never}
                locale={loc}
                answer={answers[i] as never}
                onAnswer={(a: unknown) => setAnswers((prev) => ({ ...prev, [i]: a }))}
                outcome={outcome}
                url={url}
              />
              {answer && (
                <p className="mt-3 text-sm">
                  <span className="text-muted-foreground">{t("lesson.correctAnswer")} </span>
                  <span lang={lang} className="font-medium">
                    {answer}
                  </span>
                </p>
              )}
              {outcome &&
                (outcome.result === "wrong" || outcome.result === "partial") &&
                explain?.(i, answers[i])}
            </li>
          );
        })}
      </ol>
      {/* The action bar: at the bottom of the screen, its buttons always in the same places — the main one
          (Check, then Next) on the right with a fixed width, under the finger or cursor. */}
      <div className="sticky bottom-16 z-10 -mx-4 mt-auto flex items-center gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur lg:bottom-0">
        <Button variant="ghost" size="lg" onClick={onBack}>
          {t("lesson.previous")}
        </Button>
        <div className="ml-auto flex gap-2">
          {outcomes && !readOnly && (
            <Button variant="outline" size="lg" onClick={retry}>
              {t("lesson.retry")}
            </Button>
          )}
          {scored && !outcomes && !readOnly && (
            <Button variant="ghost" size="lg" onClick={skip}>
              {t("lesson.skip")}
            </Button>
          )}
          <Button size="lg" className="w-40 text-base" onClick={primary}>
            {scored && !outcomes && !readOnly
              ? t("lesson.check")
              : last
                ? t("lesson.toSummary")
                : t("lesson.next")}
          </Button>
        </div>
      </div>
    </article>
  );
}
