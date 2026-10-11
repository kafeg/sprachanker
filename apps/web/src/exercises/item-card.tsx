// One item of an exercise as a card (09): its recording, prompt and hint, its picture or video, the
// renderer of its type, the correct answer under a wrong one where the renderer does not show it, and
// once checked the source's answer, spoken.
// The lesson player answers in it; the Notebook shows an answer given, read-only.
import type { Exercise, ItemOf, LocaleExercise, Outcome } from "@sprachanker/schema";
import { useTranslation } from "react-i18next";
import { TakeButton } from "@/audio/take-button.tsx";
import { CourseHtml } from "@/ui/course-html.tsx";
import { AudioPlayer, MediaBlock } from "@/ui/media.tsx";
import { panelClass } from "@/ui/panel.tsx";
import { useRequiredTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { GapRoom, gapRoom } from "./gaps.tsx";
import { correctAnswer, ExerciseItem, toHear } from "./index.tsx";

/** The prompt every item of an exercise has alike (two items or more), to show once above them
 *  instead of in each card; else none. The data keeps it per item. */
export function sharedPrompt(exercise: Exercise, locale: LocaleExercise | null | undefined) {
  if (exercise.items.length < 2) return undefined;
  const target = exercise.items.map((item) => item.prompt ?? "");
  const learner = exercise.items.map((_, i) => locale?.items[`#${i + 1}`]?.prompt ?? "");
  const alike = (texts: string[]) => texts.every((t) => t === texts[0]);
  if (!alike(target) || !alike(learner) || !(target[0] || learner[0])) return undefined;
  return { target: target[0] || undefined, learner: learner[0] || undefined };
}

/** The items' shared prompt (`sharedPrompt`), above them; nothing when they have none. */
export function SharedPrompt({
  exercise,
  locale,
  className,
}: {
  exercise: Exercise;
  locale: LocaleExercise | null | undefined;
  className?: string;
}) {
  const lang = useRequiredTargetLang();
  const shared = sharedPrompt(exercise, locale);
  if (!shared) return null;
  return (
    <div className={className}>
      {shared.target && (
        <p lang={lang} className="text-lg font-semibold">
          {shared.target}
        </p>
      )}
      {shared.learner && <p className="text-lg font-semibold">{shared.learner}</p>}
    </div>
  );
}

export function ItemCard({
  exercise,
  locale,
  index,
  answer,
  outcome,
  url,
  onAnswer,
  active,
  heard = true,
  onHeard,
  promptAbove = false,
  className,
}: {
  exercise: Exercise;
  locale: LocaleExercise | null | undefined;
  index: number;
  answer: unknown;
  /** Once checked: the renderer marks it and locks input. */
  outcome?: Outcome;
  url(path: string): string;
  /** Absent: read-only (an answer given before). */
  onAnswer?(answer: unknown): void;
  active?: boolean;
  /** The item's recording was heard (an answer waits for it). */
  heard?: boolean;
  onHeard?(): void;
  /** The prompt is shown above the items (`SharedPrompt`), not in the card. */
  promptAbove?: boolean;
  className?: string;
}) {
  const lang = useRequiredTargetLang();
  const { t } = useTranslation();
  const item = exercise.items[index];
  if (!item) return null;
  const loc = locale?.items[`#${index + 1}`];
  const marked = outcome && outcome.result !== "unscored";
  const right = correctAnswer(exercise, index, outcome);
  const shown = marked && outcome.result !== "correct" ? right : undefined;
  const ok = outcome?.result === "correct";
  // A speaking item with a cue (the question heard) shows its prompt — the answer to say — under the
  // cue, in the renderer; the prompt shown above the items is in neither.
  const cueFirst = exercise.type === "speech_selfrate" && "text" in item && !!item.text;
  const rendered = promptAbove && loc ? { ...loc, prompt: undefined } : loc;
  return (
    // Once checked, the card's left edge takes the result's colour (owner's choice, 2026-10-10); the
    // answer's parts carry ✓/✕, and the result is read out.
    <div
      className={cn(
        // A run with no place to break ("Führerschein/Computerkenntnisse/…") wraps inside the card.
        panelClass,
        "p-4 break-words sm:p-5",
        marked && (ok ? "border-l-4 border-l-correct" : "border-l-4 border-l-wrong"),
        className,
      )}
    >
      {marked && (
        <span role="status" className="sr-only">
          {t(
            ok
              ? "lesson.correct"
              : outcome.result === "partial"
                ? "lesson.partial"
                : "lesson.wrong",
          )}
        </span>
      )}
      {item.media?.audio && (
        <AudioPlayer
          compact
          src={url(item.media.audio)}
          label={item.prompt ?? t("lesson.itemAudio", { n: index + 1 })}
          className="mb-3"
          onHeard={onHeard}
        />
      )}
      <div className="mb-3 empty:hidden">
        {item.prompt && !promptAbove && (
          <p lang={lang} className="text-lg font-semibold">
            {item.prompt}
          </p>
        )}
        {loc?.prompt && !promptAbove && !cueFirst && (
          <p className="text-lg font-semibold">{loc.prompt}</p>
        )}
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
          onHeard={onHeard}
        />
      )}
      {/* Every typed gap of the exercise has one room (gaps.tsx). */}
      <GapRoom.Provider
        value={
          exercise.type === "gap_text"
            ? gapRoom(exercise.items as Array<ItemOf<"gap_text">>)
            : undefined
        }
      >
        <ExerciseItem
          type={exercise.type}
          item={item as never}
          locale={rendered}
          answer={answer as never}
          onAnswer={(a: unknown) => onAnswer?.(a)}
          outcome={outcome}
          url={url}
          active={active && !!onAnswer}
          listen={toHear(exercise, index).length > 0}
          heard={heard}
          readOnly={!onAnswer}
        />
      </GapRoom.Provider>
      {shown && (
        <p className="mt-3 text-sm">
          <span className="text-muted-foreground">{t("lesson.correctAnswer")} </span>
          <span lang={lang} className="font-medium whitespace-pre-line">
            {shown}
          </span>
        </p>
      )}
      {/* The source's answer, spoken, once checked (a speaking item plays it after the first try). */}
      {outcome && item.answerAudio && exercise.type !== "speech_selfrate" && (
        <TakeButton src={url(item.answerAudio)} label={t("lesson.answerAudio")} className="mt-3" />
      )}
    </div>
  );
}
