// Courses (09): "My courses" — the ones started, ready to continue — and "All courses" — every installed
// course, narrowed by two lists: which course and which language pair. A course teaches one language to
// speakers of one language (its edition); another pair of the same source course is a course of its own.
import { parseEditionId, parseLessonKey } from "@sprachanker/schema";
import { Link } from "@tanstack/react-router";
import { ArrowRight, BookOpen, CircleAlert, Download, ExternalLink, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useCatalog,
  useCourseDownload,
  useCourses,
  useSetSetting,
  useSettings,
  useStartDownload,
} from "@/api/hooks.ts";
import { editionSetting, useEdition } from "@/app/preferences.ts";
import { ErrorState, Loading, Page } from "@/ui/app-shell.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Progress } from "@/ui/components/progress.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select.tsx";
import { LanguageFlag, PairFlags, usePairName } from "@/ui/flags.tsx";
import { ResetProgress } from "@/ui/reset-progress.tsx";
import { DownloadLine, downloading, useBytes } from "./download.tsx";

type CourseRow = NonNullable<ReturnType<typeof useCourses>["data"]>[number];
type CatalogEntry = NonNullable<ReturnType<typeof useCatalog>["data"]>[number];

const ALL = "all";
const CATALOG_COURSE = "catalog.course";
const CATALOG_PAIR = "catalog.pair";

const started = (c: CourseRow) => c.done > 0 || c.nextStarted;

/** A course card: a band with the language pair and progress, the title and source, the lesson to go
 *  on with, and the way in. */
function CourseCard({
  course,
  edition,
  removable,
}: {
  course: CourseRow;
  edition: string;
  /** In "My courses": the course can be removed from there (its progress is reset). */
  removable?: boolean;
}) {
  const { t, i18n } = useTranslation();
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
          {t("courses.doneShort", { done: course.done, total: course.lessons })} ·{" "}
          {new Intl.NumberFormat(i18n.language, { style: "percent" }).format(share)}
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
        <h2 className="text-xl font-bold leading-tight">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {t("courses.lessons", { count: course.lessons })}
          {course.source && (
            <>
              {" · "}
              <a
                href={course.source.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 underline-offset-4 hover:underline"
              >
                {course.source.publisher} <ExternalLink className="size-3" />
              </a>
            </>
          )}
        </p>
        {next && course.nextTitle && (
          <p className="mt-3 text-sm">
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
              {started(course) ? t("lesson.resume") : t("courses.start")}
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
function OfferCard({ offer }: { offer: CatalogEntry }) {
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
        <h2 className="text-xl font-bold leading-tight">{offer.title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          <a
            href={offer.source.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 underline-offset-4 hover:underline"
          >
            {offer.source.publisher} <ExternalLink className="size-3" />
          </a>
          {" · "}
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
              {t("download.downloadSize", { size: `≈ ${bytes(offer.approxBytes)}` })}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** A started course in the edition in use. */
function MyCourseCard({ course }: { course: CourseRow }) {
  const edition = useEdition(course.series, course.course, course.editions);
  return edition ? <CourseCard course={course} edition={edition} removable /> : null;
}

function useCourseList() {
  const courses = useCourses();
  const settings = useSettings();
  if (courses.isPending || settings.isPending) return { state: <Loading /> };
  if (courses.isError)
    return { state: <ErrorState error={courses.error} onRetry={() => courses.refetch()} /> };
  return { all: courses.data, settings: settings.data ?? {} };
}

export function MyCoursesPage() {
  const { t } = useTranslation();
  const list = useCourseList();
  if (!list.all) return list.state;
  const mine = list.all.filter(started);
  return (
    <Page title={t("nav.myCourses")}>
      {mine.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {mine.map((c) => (
            <MyCourseCard key={c.key} course={c} />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed p-8 text-center">
          <p className="text-lg">{t("courses.noneStarted")}</p>
          <Link to="/catalog" className="mt-3 inline-block font-medium underline">
            {t("courses.toCatalog")}
          </Link>
        </div>
      )}
    </Page>
  );
}

function Filter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, React.ReactNode]>;
  onChange(value: string): void;
}) {
  const { t } = useTranslation();
  return (
    <div className="w-full space-y-1 sm:w-64">
      <p className="text-sm text-muted-foreground">{label}</p>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-11 w-full bg-card" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("courses.any")}</SelectItem>
          {options.map(([v, text]) => (
            <SelectItem key={v} value={v}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function CatalogPage() {
  const { t } = useTranslation();
  const pairName = usePairName();
  const set = useSetSetting();
  const list = useCourseList();
  const catalog = useCatalog();
  if (!list.all) return list.state;
  const all = list.all;
  // Installed courses, then those offered but not downloaded yet (the providers' catalogues).
  const cards: Array<{
    key: string;
    edition: string;
    title: string;
    course?: CourseRow;
    offer?: CatalogEntry;
  }> = [
    ...all.flatMap((course) =>
      course.editions.map((edition) => ({
        key: `${course.key}:${edition}`,
        course,
        edition,
        title: course.titles[edition] || course.key,
      })),
    ),
    ...(catalog.data ?? [])
      .filter((offer) => !offer.installed)
      .map((offer) => ({ key: offer.key, offer, edition: offer.edition, title: offer.title })),
  ];
  if (!cards.length)
    return (
      <Page title={t("nav.allCourses")}>
        <div className="rounded-2xl border border-dashed p-8 text-center">
          <p className="text-lg">{t("courses.empty")}</p>
        </div>
      </Page>
    );

  const stored = (key: string) => {
    const v = list.settings[key];
    return typeof v === "string" ? v : ALL;
  };
  const title = stored(CATALOG_COURSE);
  const pair = stored(CATALOG_PAIR);
  // Each list offers what fits the other one, so the two never combine into an empty page.
  const titles = [
    ...new Set(cards.filter((c) => pair === ALL || c.edition === pair).map((c) => c.title)),
  ];
  const pairs = [
    ...new Set(cards.filter((c) => title === ALL || c.title === title).map((c) => c.edition)),
  ];
  const shown = cards.filter(
    (c) => (title === ALL || c.title === title) && (pair === ALL || c.edition === pair),
  );
  return (
    <Page title={t("nav.allCourses")}>
      <div className="mb-6 flex flex-wrap gap-3">
        <Filter
          label={t("courses.course")}
          value={title}
          options={titles.sort((a, b) => a.localeCompare(b)).map((x) => [x, x])}
          onChange={(value) => set.mutate({ key: CATALOG_COURSE, value })}
        />
        <Filter
          label={t("courses.pair")}
          value={pair}
          options={pairs.sort().map((p) => [
            p,
            <span key={p} className="flex items-center gap-2">
              <LanguageFlag lang={parseEditionId(p).source} />
              <LanguageFlag lang={parseEditionId(p).target} />
              {pairName(p)}
            </span>,
          ])}
          onChange={(value) => set.mutate({ key: CATALOG_PAIR, value })}
        />
      </div>
      {shown.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((c) =>
            c.course ? (
              <CourseCard key={c.key} course={c.course} edition={c.edition} />
            ) : c.offer ? (
              <OfferCard key={c.key} offer={c.offer} />
            ) : null,
          )}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed p-8 text-center text-muted-foreground">
          {t("courses.noneMatch")}
        </p>
      )}
    </Page>
  );
}
