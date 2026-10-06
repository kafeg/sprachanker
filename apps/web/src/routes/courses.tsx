// Courses (09): "My courses" — the ones started, ready to continue — and "All courses" — every installed
// course, narrowed by two lists: which course and which language pair. A course teaches one language to
// speakers of one language (its edition); another pair of the same source course is a course of its own.
import { parseEditionId, parseLessonKey } from "@sprachanker/schema";
import { Link } from "@tanstack/react-router";
import { ArrowRight, BookOpen, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCourses, useSetSetting, useSettings } from "@/api/hooks.ts";
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
import { ResetProgress } from "@/ui/reset-progress.tsx";
import { cn } from "@/ui/utils.ts";
import { SourceLine } from "./course-info.tsx";

type CourseRow = NonNullable<ReturnType<typeof useCourses>["data"]>[number];

const ALL = "all";
const CATALOG_COURSE = "catalog.course";
const CATALOG_PAIR = "catalog.pair";

const started = (c: CourseRow) => c.done > 0 || c.nextStarted;

/** "ru-de" → "русский → немецкий" in the interface language. */
function usePairName() {
  const { t, i18n } = useTranslation();
  const names = new Intl.DisplayNames([i18n.language], { type: "language" });
  return (edition: string) => {
    const { source, target } = parseEditionId(edition);
    return t("courses.languages", { from: names.of(source), to: names.of(target) });
  };
}

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
  const { t } = useTranslation();
  const pair = usePairName();
  const set = useSetSetting();
  const chosen = useEdition(course.series, course.course, course.editions);
  const title = course.titles[edition] || course.key;
  const next = course.next ? parseLessonKey(course.next) : undefined;
  // A course with several editions of the same content opens in the one of this card.
  const choose = () => {
    if (chosen !== edition)
      set.mutate({ key: editionSetting(course.series, course.course), value: edition });
  };
  return (
    <div className="relative flex flex-col rounded-2xl border bg-card p-5 shadow-sm">
      {removable && (
        <ResetProgress series={course.series} course={course.course} title={title}>
          {(open) => (
            <Button
              variant="ghost"
              size="icon"
              onClick={open}
              aria-label={t("progress.removeCourse")}
              title={t("progress.removeCourse")}
              className="absolute top-3 right-3 text-muted-foreground"
            >
              <X className="size-4" />
            </Button>
          )}
        </ResetProgress>
      )}
      <h2 className={cn("text-2xl font-bold", removable && "pr-10")}>{title}</h2>
      <p className="text-sm text-muted-foreground">
        {pair(edition)} · {t("courses.lessons", { count: course.lessons })}
      </p>
      {course.source && (
        <p className="mt-1 text-xs text-muted-foreground">
          <SourceLine source={course.source} />
        </p>
      )}
      <div className="my-5">
        <Progress value={(course.done / Math.max(1, course.lessons)) * 100} className="h-2" />
        <p className="mt-2 text-sm text-muted-foreground">
          {t("courses.progress", { done: course.done, total: course.lessons })}
        </p>
      </div>
      {next && <p className="mb-2 text-sm text-muted-foreground">{t("lesson.unitLesson", next)}</p>}
      <div className="mt-auto flex flex-wrap gap-2">
        {next && (
          <Link
            to="/lesson/$series/$course/$lesson"
            params={{ series: course.series, course: course.course, lesson: next.name }}
            onClick={choose}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 font-semibold text-primary-foreground hover:bg-primary/90"
          >
            {started(course) ? t("lesson.resume") : t("courses.start")}
            <ArrowRight className="size-4" />
          </Link>
        )}
        <Link
          to="/course/$series/$course"
          params={{ series: course.series, course: course.course }}
          onClick={choose}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 font-medium hover:bg-accent"
        >
          <BookOpen className="size-4" /> {t("courses.allLessons")}
        </Link>
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
  options: Array<[string, string]>;
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
  if (!list.all) return list.state;
  const all = list.all;
  if (!all.length)
    return (
      <Page title={t("nav.allCourses")}>
        <div className="rounded-2xl border border-dashed p-8 text-center">
          <p className="text-lg">{t("courses.empty")}</p>
          <p className="mt-2 text-muted-foreground">
            {t("courses.emptyHint", { command: "sprachanker import dw-nicos-weg" })}
          </p>
        </div>
      </Page>
    );

  const cards = all.flatMap((course) =>
    course.editions.map((edition) => ({
      course,
      edition,
      title: course.titles[edition] || course.key,
    })),
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
          options={pairs.sort().map((p) => [p, pairName(p)])}
          onChange={(value) => set.mutate({ key: CATALOG_PAIR, value })}
        />
      </div>
      {shown.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((c) => (
            <CourseCard
              key={`${c.course.key}:${c.edition}`}
              course={c.course}
              edition={c.edition}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed p-8 text-center text-muted-foreground">
          {t("courses.noneMatch")}
        </p>
      )}
    </Page>
  );
}
