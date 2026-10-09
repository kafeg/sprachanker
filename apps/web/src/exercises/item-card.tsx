// One item of an exercise as a card (09): its recording, prompt and hint, its picture or video, the
// renderer of its type, and the correct answer under a wrong one where the renderer does not show it.
// The lesson player answers in it; the Notebook shows an answer given, read-only.
import type { Exercise, LocaleExercise, Outcome } from "@sprachanker/schema";
import { useTranslation } from "react-i18next";
import { CourseHtml } from "@/ui/course-html.tsx";
import { AudioPlayer, MediaBlock } from "@/ui/media.tsx";
import { useRequiredTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { correctAnswer, ExerciseItem, toHear } from "./index.tsx";

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
  className?: string;
}) {
  const lang = useRequiredTargetLang();
  const { t } = useTranslation();
  const item = exercise.items[index];
  if (!item) return null;
  const loc = locale?.items[`#${index + 1}`];
  const marked = outcome && outcome.result !== "unscored";
  const right = correctAnswer(exercise, index);
  const shown = marked && outcome.result !== "correct" ? right : undefined;
  return (
    <div className={cn("rounded-2xl border bg-card p-4 sm:p-5", className)}>
      {item.media?.audio && (
        <AudioPlayer
          compact
          src={url(item.media.audio)}
          label={item.prompt ?? t("lesson.itemAudio", { n: index + 1 })}
          className="mb-3"
          onHeard={onHeard}
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
          onHeard={onHeard}
        />
      )}
      <ExerciseItem
        type={exercise.type}
        item={item as never}
        locale={loc}
        answer={answer as never}
        onAnswer={(a: unknown) => onAnswer?.(a)}
        outcome={outcome}
        url={url}
        active={active && !!onAnswer}
        listen={toHear(exercise, index).length > 0}
        heard={heard}
        readOnly={!onAnswer}
      />
      {shown && (
        <p className="mt-3 text-sm">
          <span className="text-muted-foreground">{t("lesson.correctAnswer")} </span>
          <span lang={lang} className="font-medium">
            {shown}
          </span>
        </p>
      )}
    </div>
  );
}
