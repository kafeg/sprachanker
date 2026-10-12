// A course on "My courses" and "Downloaded" (09): the library's card (library/card) with the lessons
// done in its band, the title and publisher, on "Downloaded" its check and sync, the lesson to go on
// with, and the way in.
import { editionSetting, parseLessonKey } from "@sprachanker/schema";
import { Link } from "@tanstack/react-router";
import { ArrowRight, BookOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { useCourses } from "@/api/courses.ts";
import { useEdition } from "@/api/edition.ts";
import { useSetSetting } from "@/api/settings.ts";
import { CourseExport } from "@/library/bundle.tsx";
import { LibraryCard, PublisherLink } from "@/library/card.tsx";
import { CourseRemove, CourseUpkeep } from "@/library/upkeep.tsx";
import { Button } from "@/ui/components/button.tsx";
import { usePercent } from "@/ui/format.ts";

type CourseRow = NonNullable<ReturnType<typeof useCourses>["data"]>[number];

/** A course card: a band with the language pair and progress, the title and source, the lesson to go
 *  on with, and the way in. */
export function CourseCard({
  course,
  edition,
  removable,
  upkeep,
}: {
  course: CourseRow;
  edition: string;
  /** In "My courses": the course can be removed from there (its progress is reset). */
  removable?: boolean;
  /** In "Downloaded": the course's check, sync and export to a file. */
  upkeep?: boolean;
}) {
  const { t } = useTranslation();
  const percent = usePercent();
  const set = useSetSetting();
  const chosen = useEdition(course.series, course.course, course.editions);
  const title = course.titles[edition] || course.key;
  const nextTitle = course.nextTitles[edition];
  const next = course.next ? parseLessonKey(course.next) : undefined;
  const share = course.done / Math.max(1, course.lessons);
  // A course with several editions of the same content opens in the one of this card.
  const choose = () => {
    if (chosen !== edition)
      set.mutate({ key: editionSetting(course.series, course.course), value: edition });
  };
  return (
    <LibraryCard
      series={course.series}
      course={course.course}
      edition={edition}
      figure={t("courses.doneShort", {
        done: course.done,
        total: course.lessons,
        share: percent(share),
      })}
      share={share}
      remove={removable ? { title, label: t("progress.removeCourse") } : undefined}
    >
      {/* Long titles, sources and lesson names are cut to keep cards even; hover shows them whole. */}
      {/* A title in its own direction: a Latin one starts where it reads from in an Arabic card. */}
      <h2 dir="auto" className="line-clamp-2 text-xl font-bold leading-tight" title={title}>
        {title}
      </h2>
      <p className="mt-0.5 flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
        <span className="shrink-0">{t("courses.lessons", { count: course.lessons })}</span>
        {course.source && (
          <>
            <span className="shrink-0">·</span>
            <PublisherLink source={course.source} />
          </>
        )}
      </p>
      {upkeep && (
        <CourseUpkeep series={course.series} course={course.course}>
          <CourseExport series={course.series} course={course.course} edition={edition} />
          <CourseRemove series={course.series} course={course.course} title={title} />
        </CourseUpkeep>
      )}
      {next && nextTitle && (
        <p className="mt-3 line-clamp-2 text-sm" title={nextTitle}>
          <span className="text-muted-foreground">{t("courses.next")}: </span>
          <bdi>{nextTitle}</bdi>
          {course.nextRun?.status === "active" && (
            <span className="text-muted-foreground">
              {" · "}
              {t("courses.nextWorked", {
                worked: course.nextRun.worked,
                total: course.nextRun.total,
              })}
            </span>
          )}
        </p>
      )}
      <div className="mt-auto space-y-1 pt-4">
        {next && (
          <Button asChild size="lg" className="w-full">
            <Link
              to="/lesson/$series/$course/$lesson"
              params={{ series: course.series, course: course.course, lesson: next.name }}
              onClick={choose}
            >
              {course.started ? t("lesson.resume") : t("courses.start")}
              <ArrowRight className="rtl:-scale-x-100 size-4" />
            </Link>
          </Button>
        )}
        <Button asChild variant="ghost" size="lg" className="w-full text-muted-foreground">
          <Link
            to="/course/$series/$course"
            params={{ series: course.series, course: course.course }}
            onClick={choose}
          >
            <BookOpen className="size-4" /> {t("courses.allLessons")}
          </Link>
        </Button>
      </div>
    </LibraryCard>
  );
}

/** A started course in the edition in use. */
export function MyCourseCard({ course }: { course: CourseRow }) {
  const edition = useEdition(course.series, course.course, course.editions);
  return edition ? <CourseCard course={course} edition={edition} removable /> : null;
}
