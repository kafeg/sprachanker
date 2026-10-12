// One item of an exercise as a card: its recording, prompt and hint, its picture or video, the
// renderer of its type, the correct answer under a wrong one where the renderer does not show it, and
// once checked the source's answer, spoken.
// The lesson player answers in it; the Notebook shows an answer given, read-only.
import type { Exercise, ItemOf, LocaleExercise, Outcome } from "@sprachanker/schema";
import { useTranslation } from "react-i18next";
import { TakeButton } from "@/audio/take-button.tsx";
import { languageDir } from "@/i18n/index.ts";
import { CourseHtml } from "@/ui/course-html.tsx";
import { inLang } from "@/ui/direction.tsx";
import { keptTogether } from "@/ui/line-breaks.ts";
import { AudioPlayer, MediaBlock } from "@/ui/media.tsx";
import { panelClass } from "@/ui/panel.tsx";
import { useRequiredTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { GapRoom, gapRoom } from "./gaps.tsx";
import { correctAnswer, ExerciseItem, toHear } from "./index.tsx";
import { numberedLines, SeveralSaid } from "./shared.tsx";

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

/** A count of answers in words, and the words for the right answers it counts. */
const COUNT =
  "(?<!\\p{L})(?:two|three|four|five|several|zwei|drei|vier|fünf|mehrere|два|две|три|четыре|пять|несколько)(?!\\p{L})";
const ANSWERS =
  "(?:richtig|antwort|lösung|aussage|option|correct|answer|choice|statement|правильн|ответ|вариант|утвержден)\\p{L}*";
/** A count near what it counts (four words between at most: "Two of the statements are correct",
 *  "Правильных ответов в каждом случае несколько"); a number right before it ("2 richtige") — after a
 *  noun it names a picture or a text ("Antworten zu Bild 3"). */
const NEAR = "(?:\\s+\\S+){0,4}\\s+";
const STATED = new RegExp(
  `${COUNT}${NEAR}${ANSWERS}|${ANSWERS}${NEAR}${COUNT}|(?<![\\p{L}\\p{N}])\\d+\\s+(?:\\S+\\s+)?${ANSWERS}`,
  "iu",
);

/** A text that says how many answers are right ("Drei Antworten sind richtig", "Wähl 2 richtige",
 *  "Правильных ответов несколько"): a count or "several" near the answers it counts, in one
 *  sentence — not any number in such a sentence ("die richtigen Antworten zu Bild 3"). Pure. */
export const countStated = (text: string) =>
  text.split(/[.!?\n]/).some((sentence) => STATED.test(sentence));

/**
 * A multiple choice's "several can be right": said once above its items — "show" —, or not at
 * all when its own texts say how many are — "stated" —; undefined for other types. Pure.
 */
export function severalNote(exercise: Exercise, locale: LocaleExercise | null | undefined) {
  if (exercise.type !== "multi_choice") return undefined;
  const texts = [
    locale?.title,
    locale?.instructionHtml?.replace(/<[^>]*>/g, " "),
    ...exercise.items.map((item) => item.prompt),
    ...Object.values(locale?.items ?? {}).map((item) => item.prompt),
  ];
  return texts.some((text) => text && countStated(text)) ? ("stated" as const) : ("show" as const);
}

/** Above the items: their shared prompt (`sharedPrompt`) and a multiple choice's "several can be
 *  right" (`severalNote`); nothing when there is neither. */
export function SharedPrompt({
  exercise,
  locale,
  className,
}: {
  exercise: Exercise;
  locale: LocaleExercise | null | undefined;
  className?: string;
}) {
  const { t } = useTranslation();
  const lang = useRequiredTargetLang();
  const shared = sharedPrompt(exercise, locale);
  const several = severalNote(exercise, locale) === "show";
  if (!shared && !several) return null;
  return (
    <div className={className}>
      {several && <p className="mb-1 text-sm text-muted-foreground">{t("ex.chooseSeveral")}</p>}
      {shared && <SharedLines shared={shared} lang={lang} />}
    </div>
  );
}

function SharedLines({
  shared,
  lang,
}: {
  shared: NonNullable<ReturnType<typeof sharedPrompt>>;
  lang: string;
}) {
  return (
    <>
      {shared.target && (
        <p {...inLang(lang)} className="text-lg font-semibold text-balance">
          {keptTogether(shared.target)}
        </p>
      )}
      {shared.learner && (
        <p className="text-lg font-semibold text-balance">{keptTogether(shared.learner)}</p>
      )}
    </>
  );
}

/** Options chosen: a wrong one is wrong, not "not quite" (a text or an order partly right is). */
const CHOICES = new Set<Exercise["type"]>(["single_choice", "multi_choice"]);

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
  severalAbove = false,
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
  /** A multiple choice's "several can be right" is said above the items or by the exercise itself
   *  (`severalNote`), not in each card. */
  severalAbove?: boolean;
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
  // A speaking item's prompts are what it asks, above as any item's; its hint comes after the line to
  // say, in the renderer. The prompt shown above the items is in neither.
  const speaking = exercise.type === "speech_selfrate";
  const rendered = promptAbove && loc ? { ...loc, prompt: undefined } : loc;
  const renderedItem = promptAbove ? { ...item, prompt: undefined } : item;
  return (
    // Once checked, the card's left edge takes the result's colour (owner's choice, 2026-10-10); the
    // answer's parts carry ✓/✕, and the result is read out.
    <div
      className={cn(
        // A run with no place to break ("Führerschein/Computerkenntnisse/…") wraps inside the card.
        panelClass,
        "p-4 break-words sm:p-5",
        marked && (ok ? "border-s-4 border-s-correct" : "border-s-4 border-s-wrong"),
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
                : answer === undefined
                  ? "lesson.unanswered"
                  : CHOICES.has(exercise.type)
                    ? "lesson.incorrect"
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
          <p {...inLang(lang)} className="whitespace-pre-line text-lg font-semibold text-balance">
            {numberedLines(keptTogether(item.prompt))}
          </p>
        )}
        {loc?.prompt && !promptAbove && (
          <p className="text-lg font-semibold text-balance">{keptTogether(loc.prompt)}</p>
        )}
        {loc?.hintHtml && !speaking && (
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
        <SeveralSaid.Provider value={severalAbove}>
          {/* Laid out in the course language's direction: German's chips, gaps and options run left
              to right in an Arabic interface too. */}
          <div dir={languageDir(lang)}>
            <ExerciseItem
              type={exercise.type}
              item={renderedItem as never}
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
          </div>
        </SeveralSaid.Provider>
      </GapRoom.Provider>
      {shown && (
        <p className="mt-3 text-sm">
          <span className="text-muted-foreground">{t("lesson.correctAnswer")} </span>
          <span {...inLang(lang)} className="font-medium whitespace-pre-line">
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
