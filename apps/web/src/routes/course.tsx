// Course map (09): the course head (course-info) over a timeline of units, each with its lesson cards
// and their status.
import { parseLessonKey } from "@sprachanker/schema";
import { Link } from "@tanstack/react-router";
import { Check, CheckCircle2, CircleDot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { mediaUrl } from "@/api/client.ts";
import { useCourseMap, useCourses } from "@/api/hooks.ts";
import { useEdition } from "@/app/preferences.ts";
import { ErrorState, Loading, Page } from "@/ui/app-shell.tsx";
import { CourseMedia } from "@/ui/course-html.tsx";
import { cn } from "@/ui/utils.ts";
import { useWindowPlace } from "@/ui/window-title.ts";
import { CourseHero } from "./course-info.tsx";

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

export function CoursePage({ series, course }: { series: string; course: string }) {
  const { t } = useTranslation();
  const courses = useCourses();
  const info = courses.data?.find((c) => c.series === series && c.course === course);
  const edition = useEdition(series, course, info?.editions);
  const map = useCourseMap(series, course, edition);
  useWindowPlace(t("windowTitle.course"));
  if (courses.isPending || map.isPending) return <Loading />;
  if (map.isError) return <ErrorState error={map.error} onRetry={() => map.refetch()} />;
  const { index, locale, titles, lessons } = map.data;
  const all = index.units.flatMap((u) => u.lessons);
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
          next={
            next
              ? { key: next, title: titles[next] ?? next, started: !!info?.nextStarted }
              : undefined
          }
        />
        <ol className="relative space-y-8 before:absolute before:top-2 before:bottom-2 before:left-[15px] before:w-0.5 before:bg-border">
          {index.units.map((unit) => {
            const number = Number(unit.key.slice(-2));
            const finished = unit.lessons.filter((key) => lessons[key]?.done).length;
            const complete = finished === unit.lessons.length;
            const current = unit.lessons.some((key) => key === next);
            return (
              <li key={unit.key} className="relative pl-12">
                <span
                  className={cn(
                    "absolute top-0 left-0 grid size-8 place-items-center rounded-full border-2 bg-background text-xs font-semibold tabular-nums",
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
