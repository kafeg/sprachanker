// The lesson's first page (09): where it sits in the course, its synopsis and goals, the episode video
// or picture and recording with its transcript, and the way in (start, resume, or the result of a
// finished run).
import type { Lesson, LocaleLesson } from "@sprachanker/schema";
import { parseLessonKey } from "@sprachanker/schema";
import { useTranslation } from "react-i18next";
import { CourseHtml } from "@/ui/course-html.tsx";
import { AudioPlayer } from "@/ui/media.tsx";
import { EpisodeVideo } from "./video.tsx";

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
  return (
    <section className="space-y-5">
      <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        {t("lesson.unitLesson", parseLessonKey(lesson.key))}
        {unitTitle && ` · ${unitTitle}`}
      </p>
      <h1 className="text-4xl font-bold">{locale?.title ?? lesson.key}</h1>
      {locale?.synopsisHtml && <CourseHtml className="text-lg" html={locale.synopsisHtml} />}
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
      {lesson.media.video ? (
        <EpisodeVideo {...lesson.media.video} url={url} />
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
      {locale?.tabs.script && (lesson.media.video || lesson.media.audio) && (
        <details className="rounded-2xl border bg-card px-5 py-3">
          <summary className="cursor-pointer font-semibold">
            {lesson.media.video ? t("lesson.videoText") : t("lesson.audioText")}
          </summary>
          <CourseHtml className="mt-3" html={locale.tabs.script.bodyHtml} />
        </details>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <span className="text-muted-foreground">
          {t("lesson.counts", { exercises: lesson.pages.length, words: lesson.vocab.length })}
        </span>
        {actions}
      </div>
      {more && <div className="flex justify-end">{more}</div>}
    </section>
  );
}
