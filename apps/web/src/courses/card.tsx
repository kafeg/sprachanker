// A course on "My courses" and "Downloaded" (09): a band with the language pair and progress, the
// title and publisher, its download when one runs or files are missing (on "Downloaded" its check and
// sync), the lesson to go on with, and the way in; and a course offered but not downloaded yet, with its size and "Download".
import { type CourseSource, editionSetting, parseLessonKey } from "@sprachanker/schema";
import { Link } from "@tanstack/react-router";
import { ArrowRight, BookOpen, CircleAlert, Download, ExternalLink, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEdition } from "@/api/edition.ts";
import {
  useCatalog,
  useCourseDownload,
  type useCourses,
  useSetSetting,
  useStartDownload,
} from "@/api/hooks.ts";
import { Button } from "@/ui/components/button.tsx";
import { Progress } from "@/ui/components/progress.tsx";
import { PairFlags } from "@/ui/flags.tsx";
import { useBytes, usePercent } from "@/ui/format.ts";
import { DownloadLine, downloading } from "./download.tsx";
import { ResetProgress } from "./reset-progress.tsx";
import { CourseUpkeep } from "./upkeep.tsx";

export type CourseRow = NonNullable<ReturnType<typeof useCourses>["data"]>[number];
export type CatalogEntry = NonNullable<ReturnType<typeof useCatalog>["data"]>[number];

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
  /** In "Downloaded": the course's check and sync. */
  upkeep?: boolean;
}) {
  const { t } = useTranslation();
  const percent = usePercent();
  const set = useSetSetting();
  const chosen = useEdition(course.series, course.course, course.editions);
  const title = course.titles[edition] || course.key;
  const next = course.next ? parseLessonKey(course.next) : undefined;
  const share = course.done / Math.max(1, course.lessons);
  // A course with several editions of the same content opens in the one of this card.
  const choose = () => {
    if (chosen !== edition)
      set.mutate({ key: editionSetting(course.series, course.course), value: edition });
  };
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex min-h-14 items-center gap-3 bg-primary/15 px-4">
        <PairFlags edition={edition} size="md" />
        <span className="ml-auto text-sm tabular-nums text-muted-foreground">
          {t("courses.doneShort", { done: course.done, total: course.lessons })} · {percent(share)}
        </span>
        {removable && (
          <ResetProgress series={course.series} course={course.course} title={title}>
            {(open) => (
              <Button
                variant="ghost"
                size="icon"
                onClick={open}
                aria-label={t("progress.removeCourse")}
                title={t("progress.removeCourse")}
                className="-mr-2 text-muted-foreground"
              >
                <X className="size-4" />
              </Button>
            )}
          </ResetProgress>
        )}
      </div>
      <Progress value={share * 100} className="h-1 rounded-none" />
      <div className="flex flex-1 flex-col p-4">
        <DownloadState series={course.series} course={course.course} />
        {/* Long titles, sources and lesson names are cut to keep cards even; hover shows them whole. */}
        <h2 className="line-clamp-2 text-xl font-bold leading-tight" title={title}>
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
        {upkeep && <CourseUpkeep series={course.series} course={course.course} />}
        {next && course.nextTitle && (
          <p className="mt-3 line-clamp-2 text-sm" title={course.nextTitle}>
            <span className="text-muted-foreground">{t("courses.next")}: </span>
            {course.nextTitle}
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
            <Link
              to="/lesson/$series/$course/$lesson"
              params={{ series: course.series, course: course.course, lesson: next.name }}
              onClick={choose}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 font-semibold text-primary-foreground hover:bg-primary/90"
            >
              {course.started ? t("lesson.resume") : t("courses.start")}
              <ArrowRight className="size-4" />
            </Link>
          )}
          <Link
            to="/course/$series/$course"
            params={{ series: course.series, course: course.course }}
            onClick={choose}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <BookOpen className="size-4" /> {t("courses.allLessons")}
          </Link>
        </div>
      </div>
    </div>
  );
}

/** A course's download on its card: progress while it runs; files missing with "Continue" after. */
function DownloadState({ series, course }: { series: string; course: string }) {
  const { t } = useTranslation();
  const { job } = useCourseDownload(series, course);
  const entry = useCatalog().data?.find((e) => e.series === series && e.course === course);
  const start = useStartDownload();
  if (job && downloading(job)) return <DownloadLine job={job} className="mb-3" />;
  if (entry?.state !== "incomplete") return null;
  return (
    <div className="mb-3 flex items-center gap-2 rounded-lg bg-wrong-soft px-3 py-1.5 text-sm">
      <CircleAlert className="size-4 shrink-0 text-wrong" />
      <span className="flex-1">{t("download.incomplete", { count: entry.missing ?? 0 })}</span>
      <Button
        size="sm"
        variant="outline"
        disabled={start.isPending}
        onClick={() => start.mutate({ series, course })}
      >
        {t("download.continue")}
      </Button>
    </div>
  );
}

/** A course offered but not downloaded yet: the same card with its size and "Download". */
export function OfferCard({ offer }: { offer: CatalogEntry }) {
  const { t } = useTranslation();
  const bytes = useBytes();
  const { job } = useCourseDownload(offer.series, offer.course);
  const start = useStartDownload();
  const busy = downloading(job);
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-dashed bg-card">
      <div className="flex min-h-14 items-center gap-3 bg-muted px-4">
        <PairFlags edition={offer.edition} size="md" />
        <span className="ml-auto text-sm text-muted-foreground">{t("download.notDownloaded")}</span>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h2 className="line-clamp-2 text-xl font-bold leading-tight" title={offer.title}>
          {offer.title}
        </h2>
        <p className="mt-0.5 flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
          <PublisherLink source={offer.source} />
        </p>
        <p className="truncate text-sm text-muted-foreground">
          {t(`course.licence.${offer.source.licence}`)}
        </p>
        <div className="mt-auto pt-4">
          {busy && job ? (
            <>
              <DownloadLine job={job} />
              <p className="mt-2 text-xs text-muted-foreground">{t("download.openSoon")}</p>
            </>
          ) : (
            <Button
              size="lg"
              className="w-full"
              disabled={start.isPending}
              onClick={() => start.mutate({ series: offer.series, course: offer.course })}
            >
              <Download className="size-4" />
              {t("download.downloadSize", { size: bytes(offer.approxBytes) })}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** A started course in the edition in use. */
export function MyCourseCard({ course }: { course: CourseRow }) {
  const edition = useEdition(course.series, course.course, course.editions);
  return edition ? <CourseCard course={course} edition={edition} removable /> : null;
}

/** The course's publisher, linked to its site (cut to fit a card; hover shows it whole). */
export function PublisherLink({ source }: { source: CourseSource }) {
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noreferrer"
      title={source.publisher}
      className="flex min-w-0 items-center gap-0.5 underline-offset-4 hover:underline"
    >
      <span className="truncate">{source.publisher}</span>
      <ExternalLink className="size-3 shrink-0" />
    </a>
  );
}
