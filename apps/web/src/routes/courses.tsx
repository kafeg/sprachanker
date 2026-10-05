// "My courses": installed courses with progress and the lesson to continue.
import { parseLessonKey } from "@sprachanker/schema";
import { Link } from "@tanstack/react-router";
import { ArrowRight, BookOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCourses } from "@/api/hooks.ts";
import { useEdition } from "@/app/preferences.ts";
import { ErrorState, Loading, Page } from "@/ui/app-shell.tsx";
import { Progress } from "@/ui/components/progress.tsx";

type CourseRow = NonNullable<ReturnType<typeof useCourses>["data"]>[number];

function CourseCard({ course }: { course: CourseRow }) {
  const { t } = useTranslation();
  const edition = useEdition(course.series, course.course, course.editions);
  const title = (edition && course.titles[edition]) || course.key;
  const next = course.next ? parseLessonKey(course.next) : undefined;
  return (
    <div className="flex flex-col rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">{title}</h2>
          <p className="text-sm text-muted-foreground">
            {t("courses.lessons", { count: course.lessons })}
          </p>
        </div>
        <span className="rounded-lg bg-accent px-2 py-1 font-heading text-lg font-bold">
          {course.course.toUpperCase()}
        </span>
      </div>
      <div className="my-5">
        <Progress value={(course.done / Math.max(1, course.lessons)) * 100} className="h-2" />
        <p className="mt-2 text-sm text-muted-foreground">
          {t("courses.progress", { done: course.done, total: course.lessons })}
        </p>
      </div>
      {next && <p className="mb-2 text-sm text-muted-foreground">{t("lesson.unitLesson", next)}</p>}
      <div className="mt-auto flex flex-wrap gap-2">
        {course.next && next && (
          <Link
            to="/lesson/$series/$course/$lesson"
            params={{
              series: course.series,
              course: course.course,
              lesson: parseLessonKey(course.next).name,
            }}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 font-semibold text-primary-foreground hover:bg-primary/90"
          >
            {course.nextStarted || course.done ? t("lesson.resume") : t("courses.start")}
            <ArrowRight className="size-4" />
          </Link>
        )}
        <Link
          to="/course/$series/$course"
          params={{ series: course.series, course: course.course }}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 font-medium hover:bg-accent"
        >
          <BookOpen className="size-4" /> {t("courses.allLessons")}
        </Link>
      </div>
    </div>
  );
}

export function CoursesPage() {
  const { t } = useTranslation();
  const courses = useCourses();
  if (courses.isPending) return <Loading />;
  if (courses.isError)
    return <ErrorState error={courses.error} onRetry={() => courses.refetch()} />;
  return (
    <Page title={t("courses.title")}>
      {courses.data.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-8 text-center">
          <p className="text-lg">{t("courses.empty")}</p>
          <p className="mt-2 text-muted-foreground">
            {t("courses.emptyHint", { command: "sprachanker import dw-nicos-weg" })}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {courses.data.map((c) => (
            <CourseCard key={c.key} course={c} />
          ))}
        </div>
      )}
    </Page>
  );
}
