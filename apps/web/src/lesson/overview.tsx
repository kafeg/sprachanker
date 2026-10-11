// The lesson's first page (09): where it sits in the course, its synopsis and goals, the episode video
// (when no exercise shows it) or its picture, a recording with its transcript, and the way in (start,
// resume, or the result of a finished run).
import type { Lesson, LessonKey, LocaleLesson } from "@sprachanker/schema";
import { parseLessonKey } from "@sprachanker/schema";
import { RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ResetProgress } from "@/library/reset-progress.tsx";
import { Button } from "@/ui/components/button.tsx";
import { CourseHtml } from "@/ui/course-html.tsx";
import { AudioPlayer } from "@/ui/media.tsx";
import { panelClass } from "@/ui/panel.tsx";
import { cn } from "@/ui/utils.ts";
import { EpisodeVideo, isEpisode } from "@/ui/video.tsx";
import { wordCount } from "./plan.tsx";
import { StepHeader } from "./steps.tsx";
import type { useLessonFlow } from "./use-flow.ts";
import type { RunMode } from "./use-run.ts";

type LessonFlow = ReturnType<typeof useLessonFlow>;

export function LessonOverview({
  lesson,
  locale,
  unitTitle,
  goals,
  url,
  actions,
  more,
}: {
  lesson: Lesson;
  locale: LocaleLesson | null;
  unitTitle?: string;
  /** Goal texts of the edition, by goal key. */
  goals: Record<string, { text: string }>;
  url(path: string): string;
  /** Start, resume or the finished run's result with its buttons. */
  actions: React.ReactNode;
  /** Quieter actions under them (resetting the lesson). */
  more?: React.ReactNode;
}) {
  const { t } = useTranslation();
  // The episode is shown here only when no exercise shows it (DW: the film is the first exercise).
  const shownInExercise = lesson.pages.some(({ exercise }) =>
    [
      exercise.media?.video,
      ...exercise.items.map((i) => (i.media && "video" in i.media ? i.media.video : undefined)),
    ].some((v) => isEpisode(lesson.media.video, v)),
  );
  const video = shownInExercise ? undefined : lesson.media.video;
  return (
    <section className="space-y-5">
      <StepHeader
        label={
          <>
            {t("lesson.unitLesson", parseLessonKey(lesson.key))}
            {unitTitle && ` · ${unitTitle}`}
          </>
        }
        title={locale?.title ?? lesson.key}
      />
      {locale?.synopsisHtml && (
        <CourseHtml className={cn(panelClass, "px-5 py-4 text-lg")} html={locale.synopsisHtml} />
      )}
      {!!lesson.goals.length && (
        <div className="rounded-2xl bg-accent px-5 py-4">
          <p className="font-semibold">{t("lesson.goals")}</p>
          <ul className="mt-1 list-disc pl-5">
            {lesson.goals.map((g) => (
              <li key={g}>{goals[g]?.text}</li>
            ))}
          </ul>
        </div>
      )}
      {video ? (
        <EpisodeVideo {...video} textHtml={locale?.tabs.script?.bodyHtml} url={url} />
      ) : (
        lesson.media.image && (
          <img src={url(lesson.media.image)} alt="" className="w-full rounded-2xl" />
        )
      )}
      {lesson.media.audio && (
        <AudioPlayer
          src={url(lesson.media.audio)}
          label={locale?.title ?? lesson.key}
          title={t("lesson.audio")}
        />
      )}
      {/* The recording's transcript under it (the script page of the lesson). */}
      {locale?.tabs.script && !lesson.media.video && lesson.media.audio && (
        <details className={cn(panelClass, "px-5 py-3")}>
          <summary className="cursor-pointer font-semibold pointer-coarse:min-h-11 pointer-coarse:content-center">
            {t("lesson.audioText")}
          </summary>
          <CourseHtml className="mt-3" html={locale.tabs.script.bodyHtml} />
        </details>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <span className="text-muted-foreground">
          {t("lesson.counts", { exercises: lesson.pages.length, words: wordCount(lesson) })}
        </span>
        {actions}
      </div>
      {more && <div className="flex justify-end">{more}</div>}
    </section>
  );
}

/** The way in: Start, or Resume an open run; a finished one's score with its summary and "Redo". */
export function WayIn({ flow, mode }: { flow: LessonFlow; mode: RunMode }) {
  const { t } = useTranslation();
  const { result } = flow;
  if (mode === "finished")
    return (
      // On a phone the score takes a row and the two buttons share the next one.
      <div className="grid w-full grid-cols-2 items-center gap-2 sm:flex sm:w-auto sm:flex-wrap">
        <span className="col-span-2 text-sm font-medium">
          {result && result.scored > 0
            ? t("lesson.doneScore", { score: result.score })
            : t("lesson.done")}
        </span>
        <Button size="lg" variant="outline" onClick={() => flow.show("summary")}>
          {t("lesson.summary")}
        </Button>
        <Button
          size="lg"
          className="text-base"
          loading={flow.busy}
          onClick={() => void flow.begin(true)}
        >
          {t("lesson.redo")}
        </Button>
      </div>
    );
  const active = mode === "active";
  return (
    <Button
      size="lg"
      className="text-base"
      loading={flow.busy}
      onClick={() =>
        active ? flow.go(flow.resumeId ?? flow.ids[1] ?? "summary") : void flow.begin(false)
      }
    >
      {active && flow.worked > 0 ? t("lesson.resume") : t("lesson.start")}
    </Button>
  );
}

/** "Reset lesson progress", asked first (05). */
export function ResetLesson({
  series,
  course,
  lesson,
  title,
  onDone,
}: {
  series: string;
  course: string;
  lesson: LessonKey;
  title: string;
  onDone(): void;
}) {
  const { t } = useTranslation();
  return (
    <ResetProgress series={series} course={course} lesson={lesson} title={title} onDone={onDone}>
      {(open) => (
        <Button variant="ghost" size="sm" onClick={open} className="text-muted-foreground">
          <RotateCcw className="size-4" /> {t("progress.resetLesson")}
        </Button>
      )}
    </ResetProgress>
  );
}
