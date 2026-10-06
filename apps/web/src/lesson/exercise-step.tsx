// One exercise on its own screen: answer, check (instant, same engine as the server), feedback, next.
// "Check" opens once every item is answered and every recording has been played; checked items are
// marked on a rail left of their card, with their own controls (why wrong, answer again) on the right.
import { checkItem } from "@sprachanker/engine";
import type { Exercise, LocaleExercise, Outcome } from "@sprachanker/schema";
import { Check, RotateCcw, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { answerComplete, correctAnswer, ExerciseItem, isScored } from "@/exercises/index.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/components/tooltip.tsx";
import { CourseHtml } from "@/ui/course-html.tsx";
import { AudioPlayer, MediaBlock } from "@/ui/media.tsx";
import { useRequiredTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import type { ExerciseResult } from "./use-run.ts";

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
  onAnswered(
    answers: Array<{ itemKey: string; answer: unknown; outcome: Outcome }>,
    skipped: string[],
    ms: number,
  ): void;
  onBack(): void;
  onNext(): void;
  /** Help with a wrong item (the LLM explanation), if available: shown under it when asked for. */
  explain?(index: number, answer: unknown): React.ReactNode;
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
  const [explaining, setExplaining] = useState<Set<number>>(new Set());

  // Recordings that must be played before checking: the exercise's own and each item's. Reopening an
  // exercise answered before, or a finished run, asks for nothing.
  const recordings = [
    ...(exercise.media?.audio || exercise.media?.video ? ["exercise"] : []),
    ...exercise.items.flatMap((item, i) =>
      item.media && ("audio" in item.media || "video" in item.media) ? [`item-${i}`] : [],
    ),
  ];
  const [heard, setHeard] = useState<Set<string>>(() =>
    readOnly || Object.keys(stored?.last ?? {}).length ? new Set(recordings) : new Set(),
  );
  const hear = (key: string) => setHeard((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));

  // Checking applies to the items not checked yet (all of them, or one answered again).
  const open = exercise.items.flatMap((_, i) => (outcomes?.[i] ? [] : [i]));
  const checking = scored && !readOnly && open.length > 0;
  const answered = exercise.items.filter((_, i) => answerComplete(exercise, i, answers[i])).length;
  const unheard = recordings.find(
    (key) =>
      !heard.has(key) && (key === "exercise" || open.includes(Number(key.slice("item-".length)))),
  );
  const missing = open.filter((i) => !answerComplete(exercise, i, answers[i])).length;
  /** An item's recordings (its own and the exercise's) have been played. */
  const itemHeard = (i: number) =>
    [`item-${i}`, "exercise"].every((key) => !recordings.includes(key) || heard.has(key));
  // The item the number keys choose in: the one last touched, else the first still to answer.
  const [touched, setTouched] = useState<number>();
  const activeItem =
    touched !== undefined && open.includes(touched)
      ? touched
      : (open.find((i) => !answerComplete(exercise, i, answers[i])) ?? open[0]);
  const canCheck = checking && !missing && !unheard;
  const waiting = !checking
    ? undefined
    : missing
      ? t("lesson.answerAll", { done: answered, total: exercise.items.length })
      : unheard === "exercise"
        ? t("lesson.listenFirst")
        : unheard
          ? t("lesson.listenItem", { n: Number(unheard.slice("item-".length)) + 1 })
          : undefined;

  const check = () => {
    if (!canCheck) return;
    // Typed gaps may be left empty; an item with no answer at all is recorded as skipped (04).
    const unanswered: Outcome = {
      result: "wrong",
      score: 0,
      ruleIds: exercise.ruleIds,
      lexemes: [],
    };
    const results = open.map((i) => {
      const answer = answers[i];
      return {
        i,
        itemKey: exercise.items[i]?.key as string,
        answer,
        outcome: answer === undefined ? unanswered : checkItem(exercise, i, answer, lang),
      };
    });
    setOutcomes((prev) => ({
      ...prev,
      ...Object.fromEntries(results.map((r) => [r.i, r.outcome])),
    }));
    onAnswered(
      results.filter((r) => r.answer !== undefined),
      results.filter((r) => r.answer === undefined).map((r) => r.itemKey),
      Date.now() - shownAt.current,
    );
  };
  /** Answers one checked item again: its answer and mark are cleared; Check comes back for it. */
  const answerAgain = (i: number) => {
    setAnswers(({ [i]: _, ...rest }) => rest);
    setOutcomes((prev) => {
      const { [i]: _, ...rest } = prev ?? {};
      return Object.keys(rest).length ? rest : undefined;
    });
    setExplaining((prev) => {
      const next = new Set(prev);
      next.delete(i);
      return next;
    });
    shownAt.current = Date.now();
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
    setExplaining(new Set());
    shownAt.current = Date.now();
  };
  const primary = checking ? check : next;

  const article = useRef<HTMLElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key !== "Enter" || e.isComposing || target.tagName === "BUTTON") return;
      if (target.tagName === "SELECT" || target.closest("[role=listbox], [role=dialog]")) return;
      // In a text field Enter goes to the next field of the exercise, from the last one it checks;
      // Shift+Enter keeps a new line in a text area.
      if (target.matches("input, textarea")) {
        // Fields outside the exercise keep their own Enter.
        if (!article.current?.contains(target)) return;
        if (e.shiftKey && target.tagName === "TEXTAREA") return;
        const fields = [
          ...(article.current?.querySelectorAll<HTMLElement>(
            "input:not(:disabled):not([type=checkbox]):not([type=radio]), textarea:not(:disabled)",
          ) ?? []),
        ];
        const next = fields[fields.indexOf(target) + 1];
        e.preventDefault();
        if (next) return next.focus();
        return primary();
      }
      e.preventDefault();
      primary();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    // At least a screen tall, so the action bar sits at the bottom even under a short exercise.
    <article ref={article} className="flex min-h-[calc(100dvh-8rem)] flex-col gap-4">
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
        onHeard={() => hear("exercise")}
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
            // Rail (status) · card · controls: the card keeps its size when checked; only an
            // explanation asked for adds a panel under it.
            <li
              key={item.key}
              className="grid grid-cols-[1.5rem_minmax(0,1fr)_2.25rem] gap-x-2"
              onPointerDown={() => setTouched(i)}
              onFocus={() => setTouched(i)}
            >
              <div className="h-full">
                {marked ? (
                  <ItemRail outcome={outcome} />
                ) : (
                  // Its number, so a long exercise shows where you are.
                  exercise.items.length > 1 && (
                    <span className="block pt-4 text-center text-sm tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                  )
                )}
              </div>
              <div className="rounded-2xl border bg-card p-4 sm:p-5">
                {item.media?.audio && (
                  <AudioPlayer
                    compact
                    src={url(item.media.audio)}
                    label={item.prompt ?? t("lesson.itemAudio", { n: i + 1 })}
                    className="mb-3"
                    onHeard={() => hear(`item-${i}`)}
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
                    onHeard={() => hear(`item-${i}`)}
                  />
                )}
                <ExerciseItem
                  type={exercise.type}
                  item={item as never}
                  locale={loc}
                  answer={answers[i] as never}
                  onAnswer={(a: unknown) => {
                    setAnswers((prev) => ({ ...prev, [i]: a }));
                    // One choice answers the item: the number keys go on to the next one.
                    setTouched(exercise.type === "single_choice" ? undefined : i);
                  }}
                  outcome={outcome}
                  url={url}
                  active={i === activeItem && !readOnly}
                  heard={readOnly || itemHeard(i)}
                />
                {answer && (
                  <p className="mt-3 text-sm">
                    <span className="text-muted-foreground">{t("lesson.correctAnswer")} </span>
                    <span lang={lang} className="font-medium">
                      {answer}
                    </span>
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1.5 pt-2">
                {marked && !right && explain && (
                  <ItemControl
                    label={t("llm.why")}
                    pressed={explaining.has(i)}
                    onClick={() =>
                      setExplaining((prev) => {
                        const next = new Set(prev);
                        next.has(i) ? next.delete(i) : next.add(i);
                        return next;
                      })
                    }
                  >
                    <Sparkles className="size-4" />
                  </ItemControl>
                )}
                {marked && !readOnly && (
                  <ItemControl label={t("lesson.answerAgain")} onClick={() => answerAgain(i)}>
                    <RotateCcw className="size-4" />
                  </ItemControl>
                )}
              </div>
              {explaining.has(i) && explain && (
                <div className="col-start-2">{explain(i, answers[i])}</div>
              )}
            </li>
          );
        })}
      </ol>
      {/* The action bar: at the bottom of the screen, its buttons always in the same places — the main one
          (Check, then Next) on the right with a fixed width, under the finger or cursor. */}
      <div className="sticky bottom-0 z-10 -mx-4 mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 border-t bg-background/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <Button variant="ghost" size="lg" onClick={onBack}>
          {t("lesson.previous")}
        </Button>
        {/* What Check is waiting for. */}
        {waiting && (
          <p className="order-first w-full text-center text-xs text-muted-foreground sm:order-none sm:ml-auto sm:w-auto sm:text-right sm:text-sm">
            {waiting}
          </p>
        )}
        <div className={cn("flex gap-2", waiting ? "ml-auto sm:ml-0" : "ml-auto")}>
          {outcomes && !readOnly && (
            <Button variant="outline" size="lg" onClick={retry}>
              {t("lesson.retry")}
            </Button>
          )}
          {checking && !outcomes && (
            <Button variant="ghost" size="lg" onClick={skip}>
              {t("lesson.skip")}
            </Button>
          )}
          <Button
            size="lg"
            className="w-32 text-base sm:w-40"
            onClick={primary}
            disabled={checking && !canCheck}
          >
            {checking ? t("lesson.check") : last ? t("lesson.toSummary") : t("lesson.next")}
          </Button>
        </div>
      </div>
    </article>
  );
}
