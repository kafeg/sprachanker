// Courses: "My courses" (started) and "All courses" (installed), one card per course and edition,
// filtered by the learner's language and the language to learn (both kept in the profile, 09).
import { parseEditionId, parseLessonKey } from "@sprachanker/schema";
import { Link } from "@tanstack/react-router";
import { ArrowRight, BookOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCourses, useSetSetting, useSettings } from "@/api/hooks.ts";
import { editionSetting, useEdition } from "@/app/preferences.ts";
import { ErrorState, Loading, Page } from "@/ui/app-shell.tsx";
import { Choice } from "@/ui/choice.tsx";
import { Progress } from "@/ui/components/progress.tsx";

type CourseRow = NonNullable<ReturnType<typeof useCourses>["data"]>[number];

const FROM = "courses.from";
const TO = "courses.to";
const VIEW = "courses.view";
const ANY = "";

const started = (c: CourseRow) => c.done > 0 || c.nextStarted;

/** "ru" → "русский" in the interface language. */
function useLanguageName() {
  const { i18n } = useTranslation();
  const names = new Intl.DisplayNames([i18n.language], { type: "language" });
  return (code: string) => names.of(code) ?? code;
}

function CourseCard({ course, edition }: { course: CourseRow; edition: string }) {
  const { t } = useTranslation();
  const name = useLanguageName();
  const set = useSetSetting();
  const chosen = useEdition(course.series, course.course, course.editions);
  const { source, target } = parseEditionId(edition);
  const title = course.titles[edition] || course.key;
  const next = course.next ? parseLessonKey(course.next) : undefined;
  // Opening a card opens the course in this card's edition.
  const choose = () => {
    if (chosen !== edition)
      set.mutate({ key: editionSetting(course.series, course.course), value: edition });
  };
  return (
    <div className="flex flex-col rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">{title}</h2>
          <p className="text-sm text-muted-foreground">
            {t("courses.languages", { from: name(source), to: name(target) })} ·{" "}
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

/** A started course in the edition in use, unless the filter hides it: then its first fitting one. */
function MyCourseCard({ course, fitting }: { course: CourseRow; fitting: string[] }) {
  const chosen = useEdition(course.series, course.course, course.editions);
  const edition = chosen && fitting.includes(chosen) ? chosen : fitting[0];
  return edition ? <CourseCard course={course} edition={edition} /> : null;
}

export function CoursesPage() {
  const { t, i18n } = useTranslation();
  const name = useLanguageName();
  const courses = useCourses();
  const settings = useSettings();
  const set = useSetSetting();
  if (courses.isPending || settings.isPending) return <Loading />;
  if (courses.isError)
    return <ErrorState error={courses.error} onRetry={() => courses.refetch()} />;

  const all = courses.data;
  const pairs = all.flatMap((c) =>
    c.editions.map((edition) => ({ course: c, edition, ...parseEditionId(edition) })),
  );
  const sources = [...new Set(pairs.map((p) => p.source))].sort();
  const targets = [...new Set(pairs.map((p) => p.target))].sort();
  const stored = (key: string) => {
    const v = settings.data?.[key];
    return typeof v === "string" ? v : undefined;
  };
  // Defaults: the learner's language is the interface language when a course explains in it.
  const from =
    stored(FROM) ?? (sources.includes(i18n.language.slice(0, 2)) ? i18n.language.slice(0, 2) : ANY);
  const to = stored(TO) ?? ANY;
  const mine = all.filter(started);
  const view = stored(VIEW) ?? (mine.length ? "mine" : "all");
  const fits = (p: { source: string; target: string }) =>
    (!from || p.source === from) && (!to || p.target === to);
  const shownMine = mine
    .map((course) => ({
      course,
      fitting: pairs.filter((p) => p.course === course && fits(p)).map((p) => p.edition),
    }))
    .filter((m) => m.fitting.length);
  const shownAll = pairs.filter(fits);

  const filter = (key: string, value: string, options: string[]) => (
    <Choice
      value={value}
      options={[[ANY, t("courses.any")], ...options.map((o): [string, string] => [o, name(o)])]}
      onChange={(v) => set.mutate({ key, value: v })}
    />
  );

  return (
    <Page title={t("courses.title")}>
      {all.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-8 text-center">
          <p className="text-lg">{t("courses.empty")}</p>
          <p className="mt-2 text-muted-foreground">
            {t("courses.emptyHint", { command: "sprachanker import dw-nicos-weg" })}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <Choice
              value={view}
              options={[
                ["mine", t("courses.mine", { count: shownMine.length })],
                ["all", t("courses.all", { count: shownAll.length })],
              ]}
              onChange={(v) => set.mutate({ key: VIEW, value: v })}
            />
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">{t("courses.from")}</p>
              {filter(FROM, from, sources)}
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">{t("courses.to")}</p>
              {filter(TO, to, targets)}
            </div>
          </div>
          <CourseGrid view={view} mine={shownMine} pairs={shownAll} />
        </div>
      )}
    </Page>
  );
}

/** The cards of the chosen view, already filtered by language. */
function CourseGrid({
  view,
  mine,
  pairs,
}: {
  view: string;
  mine: Array<{ course: CourseRow; fitting: string[] }>;
  pairs: Array<{ course: CourseRow; edition: string }>;
}) {
  const { t } = useTranslation();
  const cards =
    view === "mine"
      ? mine.map((m) => <MyCourseCard key={m.course.key} course={m.course} fitting={m.fitting} />)
      : pairs.map((p) => (
          <CourseCard key={`${p.course.key}:${p.edition}`} course={p.course} edition={p.edition} />
        ));
  if (!cards.length)
    return (
      <p className="rounded-2xl border border-dashed p-8 text-center text-muted-foreground">
        {view === "mine" ? t("courses.noneStarted") : t("courses.noneMatch")}
      </p>
    );
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{cards}</div>;
}
