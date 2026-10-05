// One exercise on its own screen: answer, check (instant, same engine as the server), feedback, next.
import { checkItem } from "@sprachanker/engine";
import type { Exercise, LocaleExercise, Outcome } from "@sprachanker/schema";
import { Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { correctAnswer, ExerciseItem, isScored } from "@/exercises/index.tsx";
import { Button } from "@/ui/components/button.tsx";
import { CourseHtml } from "@/ui/course-html.tsx";
import { MediaBlock } from "@/ui/media.tsx";
import { cn } from "@/ui/utils.ts";

function Feedback({ outcome, answer }: { outcome: Outcome; answer?: string }) {
  const { t } = useTranslation();
  const ok = outcome.result === "correct";
  return (
    <div
      role="status"
      className={cn(
        "mt-3 flex items-start gap-2 rounded-xl px-3 py-2 font-medium",
        ok ? "bg-correct-soft text-correct" : "bg-wrong-soft text-wrong",
      )}
    >
      {ok ? <Check className="mt-0.5 size-5 shrink-0" /> : <X className="mt-0.5 size-5 shrink-0" />}
      <span>
        {t(
          ok ? "lesson.correct" : outcome.result === "partial" ? "lesson.partial" : "lesson.wrong",
        )}
        {!ok && (
          <span className="ml-2 font-normal text-foreground">
            {answer ? t("lesson.answerWas", { answer }) : t("ex.correctHighlighted")}
          </span>
        )}
      </span>
    </div>
  );
}

export interface StepProps {
  exercise: Exercise;
  locale?: LocaleExercise;
  index: number;
  total: number;
  url(p: string): string;
  onAnswered(
    answers: Array<{ itemKey: string; answer: unknown; outcome: Outcome }>,
    ms: number,
  ): void;
  onSkip(): void;
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
  onAnswered,
  onSkip,
  onBack,
  onNext,
  explain,
}: StepProps) {
  const { t } = useTranslation();
  const [answers, setAnswers] = useState<Record<number, unknown>>({});
  const [outcomes, setOutcomes] = useState<Record<number, Outcome>>();
  const shownAt = useRef(Date.now());
  const scored = isScored(exercise.type);
  const last = index + 1 === total;

  const check = () => {
    // Unanswered items are wrong; only given answers are recorded.
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
        outcome: answer === undefined ? unanswered : checkItem(exercise, i, answer, "de"),
      };
    });
    setOutcomes(Object.fromEntries(results.map((r, i) => [i, r.outcome])));
    onAnswered(
      results.filter((r) => r.answer !== undefined),
      Date.now() - shownAt.current,
    );
  };
  const next = () => {
    if (!scored) {
      const rated = exercise.items.flatMap((item, i) =>
        answers[i]
          ? [
              {
                itemKey: item.key,
                answer: answers[i],
                outcome: checkItem(exercise, i, answers[i], "de"),
              },
            ]
          : [],
      );
      onAnswered(rated, Date.now() - shownAt.current);
    }
    onNext();
  };
  const retry = () => {
    setAnswers({});
    setOutcomes(undefined);
    shownAt.current = Date.now();
  };
  const primary = scored && !outcomes ? check : next;

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
    <article className="space-y-4">
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
        <p lang="de" className="text-lg">
          {exercise.text}
        </p>
      )}
      {locale?.textHtml && (
        <CourseHtml className="rounded-xl bg-muted px-4 py-2" html={locale.textHtml} />
      )}
      <ol className="space-y-6">
        {exercise.items.map((item, i) => {
          const loc = locale?.items[`#${i + 1}`];
          const outcome = outcomes?.[i];
          return (
            <li key={item.key} className="rounded-2xl border bg-card p-4 sm:p-5">
              <div className="mb-3 flex items-start gap-3">
                {item.media?.audio && (
                  <MediaBlock
                    media={{ audio: item.media.audio }}
                    url={url}
                    audioLabel={item.prompt ?? ""}
                  />
                )}
                <div className="min-w-0 flex-1 pt-1">
                  {item.prompt && (
                    <p lang="de" className="text-lg font-semibold">
                      {item.prompt}
                    </p>
                  )}
                  {loc?.prompt && <p className="text-lg font-semibold">{loc.prompt}</p>}
                  {loc?.hintHtml && (
                    <CourseHtml className="text-sm text-muted-foreground" html={loc.hintHtml} />
                  )}
                </div>
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
              {outcome && outcome.result !== "unscored" && (
                <Feedback outcome={outcome} answer={correctAnswer(exercise, i)} />
              )}
              {outcome &&
                (outcome.result === "wrong" || outcome.result === "partial") &&
                explain?.(i, answers[i])}
            </li>
          );
        })}
      </ol>
      <div className="sticky bottom-16 z-10 -mx-4 flex flex-wrap items-center gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:mx-0 lg:rounded-2xl lg:border">
        <Button variant="ghost" size="lg" onClick={onBack}>
          {t("lesson.previous")}
        </Button>
        <div className="ml-auto flex gap-2">
          {outcomes && (
            <Button variant="outline" size="lg" onClick={retry}>
              {t("lesson.retry")}
            </Button>
          )}
          {scored && !outcomes && (
            <Button variant="ghost" size="lg" onClick={onSkip}>
              {t("lesson.skip")}
            </Button>
          )}
          <Button size="lg" className="min-w-36 text-base" onClick={primary}>
            {scored && !outcomes
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
