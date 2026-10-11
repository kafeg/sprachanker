// The Notebook (09): progress first — every module's headline figures (words known, lessons and courses
// done); the study days of the last year as a calendar, with the totals of all time, 30 or 7 days
// (lesson work, exam answers, cards answered, new cards, the share remembered, AI practice, time
// spent) and the time spent over the span; then each module's standing the same way (schema
// `stats.ts`, notebook/standing): each language's review deck (its words by state, its review days)
// under the cards answered and the share remembered over the span, the journal by lesson (owner's
// choice A, 2026-10-07) — the lessons done over the span, the courses with the lessons worked on, each
// opening its passes — and the exams with their latest mock exams. What a module adds here is only
// where its entries open, how they are named and its pictures (`useViews`, notebook/pictures).
import { activityTotals, type Span } from "@sprachanker/engine";
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
import { useDateFormat, useDuration, useNumber, usePercent } from "@/ui/format.ts";
import { ErrorState, Loading, Page } from "@/ui/page.tsx";
import { Panel } from "@/ui/panel.tsx";
import { StatTile } from "@/ui/stat-tile.tsx";
import {
  CardsPicture,
  DonePicture,
  RememberedPicture,
  type SpanBars,
  TimePicture,
  useSpan,
  WordsPicture,
} from "./pictures.tsx";
import { type EntryView, FigureTile, StandingSection } from "./standing.tsx";

type Day = NotebookOverview["days"][number];
const RANGES: Record<Span, number | undefined> = { all: undefined, month: 30, week: 7 };

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

function Progress({
  overview,
  range,
  setRange,
  span: bars,
}: {
  overview: NotebookOverview;
  range: Span;
  setRange(range: Span): void;
  span: SpanBars;
}) {
  const { t } = useTranslation();
  const percent = usePercent();
  const duration = useDuration();
  const describe = useDescribeDay(overview.days);
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
          {(Object.keys(RANGES) as Span[]).map((r) => (
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
          <StatTile
            label={t("notebook.tile.time")}
            value={totals.timeAll ? duration(totals.timeAll) : "—"}
            note={t("notebook.tile.timeHint")}
          />
        </div>
        <div className="mt-4">
          <TimePicture span={bars} />
        </div>
      </Panel>
    </>
  );
}

/** Where each module's entries open, how they are named and their pictures. */
function useViews(): Partial<Record<ModuleId, EntryView>> {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  return {
    // A language's deck: its flag and name, its words by state; it opens the decks, a review day its
    // answers.
    review: {
      title: (deck) => (
        <span className="flex items-center gap-2">
          <LanguageFlag lang={deck.key} />
          {languageName(deck.key, i18n.language, true)}
        </span>
      ),
      picture: (deck) => <WordsPicture figures={deck.figures} />,
      open: () => void navigate({ to: "/review/decks" }),
      openRun: (deck, run) =>
        void navigate({
          to: "/notebook/review/$run",
          params: { run: run.id },
          search: { lang: deck.key },
        }),
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
  if (notebook.isPending) return <Loading />;
  if (notebook.isError)
    return <ErrorState error={notebook.error} onRetry={() => notebook.refetch()} />;
  return (
    <Page title={t("notebook.title")}>
      <Overview overview={notebook.data} />
    </Page>
  );
}

function Overview({ overview }: { overview: NotebookOverview }) {
  const views = useViews();
  // The span the totals and the pictures cover.
  const [range, setRange] = useState<Span>("all");
  const span = useSpan(overview, range);
  // Each module's pictures over the span.
  const pictures: Partial<Record<ModuleId, React.ReactNode>> = {
    review: (
      <>
        <CardsPicture span={span} />
        <RememberedPicture span={span} />
      </>
    ),
  };
  const done = overview.modules
    .find((m) => m.module === "lesson")
    ?.figures.find((f) => f.id === "lessonsDone");
  if (done?.value) pictures.lesson = <DonePicture span={span} done={done} />;
  return (
    <div className="max-w-3xl space-y-4">
      <Progress overview={overview} range={range} setRange={setRange} span={span} />
      {overview.modules.map((m) => (
        <StandingSection
          key={m.module}
          module={m.module}
          entries={m.entries}
          view={views[m.module] ?? {}}
        >
          {pictures[m.module]}
        </StandingSection>
      ))}
    </div>
  );
}
