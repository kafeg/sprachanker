// Course map (09): the course head (course-info) over a timeline of units, each with its lesson cards
// and their status.
import { lessonDone } from "@sprachanker/engine";
import { parseLessonKey } from "@sprachanker/schema";
import { Link } from "@tanstack/react-router";
import { Check, CheckCircle2, CircleDot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCourseMap, useCourses } from "@/api/hooks.ts";
import { useEdition } from "@/app/preferences.ts";
import { ErrorState, Loading, Page } from "@/ui/app-shell.tsx";
import { cn } from "@/ui/utils.ts";
import { CourseHero } from "./course-info.tsx";

type Progress = NonNullable<ReturnType<typeof useCourseMap>["data"]>["progress"];

function LessonCard({
  series,
  course,
  lessonKey,
  title,
  progress,
  isNext,
}: {
  series: string;
  course: string;
  lessonKey: string;
  title: string;
  progress: Progress[string] | undefined;
  isNext: boolean;
}) {
  const { t } = useTranslation();
  const { lesson, name } = parseLessonKey(lessonKey);
  const status = progress?.status ?? "new";
  return (
    <Link
      to="/lesson/$series/$course/$lesson"
      params={{ series, course, lesson: name }}
      className={cn(
        "group flex min-h-24 flex-col justify-between rounded-xl border bg-card p-3.5 transition hover:-translate-y-0.5 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        status === "done" && "border-correct/40",
        (isNext || status === "in_progress") && "border-2 border-primary",
      )}
    >
      <div>
        <div className="text-xs text-muted-foreground tabular-nums">{lesson}</div>
        <div className="font-heading font-semibold leading-tight">{title}</div>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-xs">
        {status === "done" ? (
          <span className="flex items-center gap-1 text-correct">
            <CheckCircle2 className="size-3.5" />
            {progress?.bestScore === undefined
              ? t("course.status.finished")
              : t("course.status.done", { score: progress.bestScore })}
          </span>
        ) : status === "in_progress" ? (
          <span className="flex items-center gap-1 font-medium">
            <CircleDot className="size-3.5 text-primary" /> {t("course.status.in_progress")}
            {progress?.bestScore !== undefined && (
              <span className="font-normal text-muted-foreground">
                · {t("course.status.best", { score: progress.bestScore })}
              </span>
            )}
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
  if (courses.isPending || map.isPending) return <Loading />;
  if (map.isError) return <ErrorState error={map.error} onRetry={() => map.refetch()} />;
  const { index, locale, titles, progress } = map.data;
  const all = index.units.flatMap((u) => u.lessons);
  const next = info?.next;
  return (
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
          const finished = unit.lessons.filter((key) => lessonDone(progress[key])).length;
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
                    progress={progress[key]}
                    isNext={key === next && progress[key]?.status !== "done"}
                  />
                ))}
              </div>
            </li>
          );
        })}
      </ol>
    </Page>
  );
}
