// Course map: the course head (course-info) over a timeline of units, each with its lesson cards
// and their status.

import { lessonOrder, parseLessonKey } from "@sprachanker/schema";
import { Link } from "@tanstack/react-router";
import { Check, CheckCircle2, CircleDot } from "lucide-react";
import { Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { mediaUrl } from "@/api/client.ts";
import { useCourseMap } from "@/api/courses.ts";
import { useCourseEdition } from "@/api/edition.ts";
import { CourseHero } from "@/courses/hero.tsx";
import { CourseGone } from "@/library/course-gone.tsx";
import { CourseMedia } from "@/ui/course-html.tsx";
import { ErrorState, Loading, Page } from "@/ui/page.tsx";
import { cn } from "@/ui/utils.ts";
import { useWindowPlace } from "@/ui/window-title.ts";

type LessonState = NonNullable<ReturnType<typeof useCourseMap>["data"]>["lessons"][string];

/** A lesson card: its status is the run the lesson opens, read like the player reads it. */
function LessonCard({
  series,
  course,
  lessonKey,
  title,
  state,
  isNext,
}: {
  series: string;
  course: string;
  lessonKey: string;
  title: string;
  state: LessonState | undefined;
  isNext: boolean;
}) {
  const { t } = useTranslation();
  const { lesson, name } = parseLessonKey(lessonKey);
  const run = state?.run;
  const finished = run?.status === "finished";
  const working = run?.status === "active";
  return (
    <Link
      to="/lesson/$series/$course/$lesson"
      params={{ series, course, lesson: name }}
      className={cn(
        "group flex min-h-24 flex-col justify-between rounded-xl border bg-card p-3.5 transition hover:-translate-y-0.5 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        finished && "border-correct/40",
        (isNext || working) && "border-2 border-primary",
      )}
    >
      <div>
        <div className="text-xs text-muted-foreground tabular-nums">{lesson}</div>
        <div className="font-heading font-semibold leading-tight">{title}</div>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-xs">
        {finished ? (
          <span className="flex items-center gap-1 text-correct">
            <CheckCircle2 className="size-3.5" />
            {run.score === undefined
              ? t("course.status.finished")
              : t("course.status.done", { score: run.score })}
          </span>
        ) : working ? (
          <span className="flex items-center gap-1 font-medium">
            <CircleDot className="size-3.5 text-primary" />
            {t("course.status.in_progress", { worked: run.worked, total: run.total })}
          </span>
        ) : isNext ? (
          <span className="font-medium">{t("course.status.next")}</span>
        ) : (
          <span className="text-muted-foreground">{t("course.status.new")}</span>
        )}
      </div>
    </Link>
  );
}

type CourseIds = { series: string; course: string; edition: string };
/** What an optional feature adds to a course's page (the AI assistant: the course's practice): a
 *  button among the course's actions, and what it opens under the course's head. */
export type CourseExtra = {
  Button: React.ComponentType<CourseIds & { open: boolean; onToggle(): void }>;
  Panel: React.ComponentType<CourseIds>;
};

export function CoursePage({
  series,
  course,
  extra: Extra,
}: {
  series: string;
  course: string;
  extra?: CourseExtra;
}) {
  const { t } = useTranslation();
  const { courses, info, edition } = useCourseEdition(series, course);
  const map = useCourseMap(series, course, edition);
  const [extraOpen, setExtraOpen] = useState(false);
  useWindowPlace(t("windowTitle.course"));
  if (courses.isPending) return <Loading />;
  if (!info) return <CourseGone series={series} course={course} />;
  if (map.isPending) return <Loading />;
  if (map.isError) return <ErrorState error={map.error} onRetry={() => map.refetch()} />;
  const { index, locale, titles, lessons } = map.data;
  const all = lessonOrder(index);
  const next = info?.next;
  return (
    <CourseMedia.Provider value={(path) => mediaUrl(series, path)}>
      <Page>
        <CourseHero
          series={series}
          course={course}
          title={locale?.title ?? index.key}
          edition={edition ?? ""}
          descriptionHtml={locale?.descriptionHtml}
          source={index.source ?? null}
          done={info?.done ?? 0}
          lessons={all.length}
          next={next ? { key: next, title: titles[next] ?? next } : undefined}
          started={!!info?.started}
          actions={
            Extra &&
            edition && (
              <Suspense fallback={null}>
                <Extra.Button
                  series={series}
                  course={course}
                  edition={edition}
                  open={extraOpen}
                  onToggle={() => setExtraOpen((open) => !open)}
                />
              </Suspense>
            )
          }
        />
        {Extra && edition && extraOpen && (
          <Suspense fallback={null}>
            <Extra.Panel series={series} course={course} edition={edition} />
          </Suspense>
        )}
        <ol className="relative space-y-8 before:absolute before:top-2 before:bottom-2 before:start-[15px] before:w-0.5 before:bg-border">
          {index.units.map((unit) => {
            const number = Number(unit.key.slice(-2));
            const finished = unit.lessons.filter((key) => lessons[key]?.done).length;
            const complete = finished === unit.lessons.length;
            const current = unit.lessons.some((key) => key === next);
            return (
              <li key={unit.key} className="relative ps-12">
                <span
                  className={cn(
                    "absolute top-0 start-0 grid size-8 place-items-center rounded-full border-2 bg-background text-xs font-semibold tabular-nums",
                    complete && "border-correct bg-correct text-white",
                    current && !complete && "border-primary",
                  )}
                  aria-hidden="true"
                >
                  {complete ? <Check className="size-4" /> : number}
                </span>
                <h2 className="mb-3 flex flex-wrap items-baseline gap-x-2 pt-1 text-lg font-bold">
                  <span className="text-muted-foreground">{t("course.unit", { number })}</span>
                  <span>{locale?.units[unit.key]?.title}</span>
                  <span className="text-sm font-normal text-muted-foreground tabular-nums">
                    {finished} / {unit.lessons.length}
                  </span>
                </h2>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                  {unit.lessons.map((key) => (
                    <LessonCard
                      key={key}
                      series={series}
                      course={course}
                      lessonKey={key}
                      title={titles[key] ?? key}
                      state={lessons[key]}
                      isNext={key === next && lessons[key]?.run?.status !== "finished"}
                    />
                  ))}
                </div>
              </li>
            );
          })}
        </ol>
      </Page>
    </CourseMedia.Provider>
  );
}
