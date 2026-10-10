// The Notebook (09): progress first — every module's headline figures (words known, lessons done); the
// study days of the last year as a calendar, with the totals of all time, 30 or 7 days (lesson work,
// exam answers, cards answered, new cards, the share remembered, AI practice); then each module's
// standing the same way (schema `stats.ts`, notebook/standing): each language's review deck, the
// journal by lesson (owner's choice A, 2026-10-07) — the courses with the lessons worked on, each
// opening its passes — and the exams with their latest mock exams. What a module adds here is only
// where its entries open and how they are named (`useViews`).
import { activityTotals } from "@sprachanker/engine";
import {
  type LessonKey,
  MODULES,
  type ModuleId,
  parseLessonKey,
  seriesOf,
} from "@sprachanker/schema";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type NotebookOverview, useNotebook } from "@/api/notebook.ts";
import { languageName } from "@/i18n/index.ts";
import { examParams } from "@/library/exam-address.ts";
import { ActivityCalendar } from "@/ui/activity-calendar.tsx";
import { Chip } from "@/ui/chip.tsx";
import { LanguageFlag } from "@/ui/flags.tsx";
import { useDateFormat, useNumber, usePercent } from "@/ui/format.ts";
import { ErrorState, Loading, Page } from "@/ui/page.tsx";
import { Panel } from "@/ui/panel.tsx";
import { StatTile } from "@/ui/stat-tile.tsx";
import { type EntryView, FigureTile, StandingSection } from "./standing.tsx";

type Day = NotebookOverview["days"][number];
const RANGES = { all: undefined, month: 30, week: 7 } as const;
type Range = keyof typeof RANGES;

/** What a day had: its date, then each module's work where there was any. */
function useDescribeDay(days: Day[]) {
  const { t } = useTranslation();
  const date = useDateFormat("day");
  const byStart = new Map(days.map((d) => [new Date(d.start).toDateString(), d]));
  return (start: number) => {
    const day = byStart.get(new Date(start).toDateString());
    const what = day
      ? MODULES.filter((k) => day[k])
          .map((k) => t(`notebook.kind.${k}`, { count: day[k] }))
          .join(", ")
      : "";
    return t("notebook.dayTitle", {
      date: date.format(start),
      what: what || t("notebook.nothing"),
    });
  };
}

function Progress({ overview }: { overview: NotebookOverview }) {
  const { t } = useTranslation();
  const percent = usePercent();
  const describe = useDescribeDay(overview.days);
  const [range, setRange] = useState<Range>("all");
  const count = useNumber();
  const span = RANGES[range];
  const from = (() => {
    if (!span) return undefined;
    const d = new Date(overview.today);
    d.setDate(d.getDate() - (span - 1));
    return d.getTime();
  })();
  const totals = activityTotals(overview.days, from);
  const headline = overview.modules.flatMap((m) =>
    m.figures.map((figure) => ({ module: m.module, figure })),
  );
  return (
    <>
      <Panel title={t("notebook.progress")}>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {headline.map(({ module, figure }) => (
            <FigureTile key={`${module}:${figure.id}`} module={module} figure={figure} />
          ))}
        </div>
      </Panel>
      <Panel title={t("notebook.days")}>
        <div className="mt-2">
          <ActivityCalendar
            today={overview.today}
            days={overview.days.map((d) => ({
              start: d.start,
              count: MODULES.reduce((n, m) => n + d[m], 0),
            }))}
            describe={describe}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {(Object.keys(RANGES) as Range[]).map((r) => (
            <Chip key={r} on={range === r} onClick={() => setRange(r)}>
              {t(`notebook.range.${r}`)}
            </Chip>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <StatTile label={t("notebook.tile.activeDays")} value={count(totals.activeDays)} />
          <StatTile label={t("notebook.tile.lesson")} value={count(totals.lesson)} />
          <StatTile label={t("notebook.tile.exam")} value={count(totals.exam)} />
          <StatTile label={t("notebook.tile.review")} value={count(totals.review)} />
          <StatTile label={t("notebook.tile.newCards")} value={count(totals.newCards)} />
          <StatTile
            label={t("notebook.tile.remembered")}
            value={totals.remembered === undefined ? "—" : percent(totals.remembered)}
            note={t("notebook.tile.rememberedHint")}
          />
          <StatTile label={t("notebook.tile.ai")} value={count(totals.ai)} />
        </div>
      </Panel>
    </>
  );
}

/** Where each module's entries open and how they are named. */
function useViews(): Partial<Record<ModuleId, EntryView>> {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  return {
    // A language's deck: its flag and name; it opens the decks.
    review: {
      title: (deck) => (
        <span className="flex items-center gap-2">
          <LanguageFlag lang={deck.key} />
          {languageName(deck.key, i18n.language, true)}
        </span>
      ),
      open: () => void navigate({ to: "/review/decks" }),
    },
    // A lesson by its number in the course; it opens its passes.
    lesson: {
      title: (l) => {
        const { unit, lesson } = parseLessonKey(l.key);
        return `${unit}.${lesson} ${l.title ?? ""}`;
      },
      open: (l) => {
        const { courseId, name } = parseLessonKey(l.key);
        void navigate({
          to: "/notebook/$series/$course/$lesson",
          params: { series: seriesOf(l.key as LessonKey), course: courseId, lesson: name },
        });
      },
    },
    // An exam: its mock exams open their results; the rest is on its own page in the Notebook.
    exam: {
      open: (e) =>
        void navigate({ to: "/notebook/exam/$series/$course/$exam", params: examParams(e.key) }),
      openRun: (e, run) =>
        void navigate({
          to: "/exam/$series/$course/$exam/run/$run",
          params: { ...examParams(e.key), run: run.id },
        }),
    },
  };
}

export function NotebookPage() {
  const { t } = useTranslation();
  const notebook = useNotebook();
  const views = useViews();
  if (notebook.isPending) return <Loading />;
  if (notebook.isError)
    return <ErrorState error={notebook.error} onRetry={() => notebook.refetch()} />;
  const { modules } = notebook.data;
  return (
    <Page title={t("notebook.title")}>
      <div className="max-w-3xl space-y-4">
        <Progress overview={notebook.data} />
        {modules.map((m) => (
          <StandingSection
            key={m.module}
            module={m.module}
            entries={m.entries}
            view={views[m.module] ?? {}}
          />
        ))}
      </div>
    </Page>
  );
}
