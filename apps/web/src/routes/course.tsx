// Course map: units and lessons with their status (09).
import { parseLessonKey } from "@sprachanker/schema";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, CircleDot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCourseMap, useCourses } from "@/api/hooks.ts";
import { useEdition } from "@/app/preferences.ts";
import { ErrorState, Loading, Page } from "@/ui/app-shell.tsx";
import { CourseHtml } from "@/ui/course-html.tsx";
import { cn } from "@/ui/utils.ts";
import { CourseInfo } from "./course-info.tsx";

export function CoursePage({ series, course }: { series: string; course: string }) {
  const { t } = useTranslation();
  const courses = useCourses();
  const info = courses.data?.find((c) => c.series === series && c.course === course);
  const edition = useEdition(series, course, info?.editions);
  const map = useCourseMap(series, course, edition);
  if (courses.isPending || map.isPending) return <Loading />;
  if (map.isError) return <ErrorState error={map.error} onRetry={() => map.refetch()} />;
  const { index, locale, titles, progress } = map.data;
  return (
    <Page title={locale?.title ?? index.key}>
      {locale?.descriptionHtml && (
        <CourseHtml className="mb-4 text-muted-foreground" html={locale.descriptionHtml} />
      )}
      <CourseInfo series={series} course={course} source={index.source ?? null} />
      <div className="space-y-8">
        {index.units.map((unit) => {
          const number = Number(unit.key.slice(-2));
          return (
            <section key={unit.key}>
              <h2 className="mb-3 flex items-baseline gap-3 text-xl font-bold">
                <span className="text-muted-foreground">{t("course.unit", { number })}</span>
                <span>{locale?.units[unit.key]?.title}</span>
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {unit.lessons.map((key) => {
                  const p = progress[key];
                  const { lesson, name } = parseLessonKey(key);
                  return (
                    <Link
                      key={key}
                      to="/lesson/$series/$course/$lesson"
                      params={{ series, course, lesson: name }}
                      className={cn(
                        "group flex min-h-24 flex-col justify-between rounded-xl border bg-card p-4 transition hover:-translate-y-0.5 hover:shadow-md",
                        p?.status === "done" && "border-correct/40",
                        p?.status === "in_progress" && "border-primary",
                      )}
                    >
                      <div>
                        <div className="text-sm text-muted-foreground">{lesson}</div>
                        <div className="font-heading text-lg font-semibold leading-tight">
                          {titles[key] ?? key}
                        </div>
                      </div>
                      <div className="mt-2 flex items-center gap-1.5 text-sm">
                        {p?.status === "done" ? (
                          <span className="flex items-center gap-1 text-correct">
                            <CheckCircle2 className="size-4" />
                            {t("course.status.done", {
                              score: Math.round((p.bestScore ?? 0) * 100),
                            })}
                          </span>
                        ) : p?.status === "in_progress" ? (
                          <span className="flex items-center gap-1 font-medium">
                            <CircleDot className="size-4 text-primary" />{" "}
                            {t("course.status.in_progress")}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">{t("course.status.new")}</span>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </Page>
  );
}
