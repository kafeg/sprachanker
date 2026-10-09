// The Notebook (09): progress first — words known and lessons done; the study days of the last year
// as a calendar, with the totals of all time, 30 or 7 days (lesson work, cards answered, new cards,
// the share remembered, AI practice); then the journal by lesson (owner's choice A, 2026-10-07): the
// courses with the lessons worked on — passes, the best score, one still open — each opening its passes.
import { activityTotals } from "@sprachanker/engine";
import { parseLessonKey, seriesOf } from "@sprachanker/schema";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type NotebookOverview, useNotebook } from "@/api/hooks.ts";
import { ActivityCalendar } from "@/ui/activity-calendar.tsx";
import { Chip } from "@/ui/chip.tsx";
import { useDateFormat, useNumber, usePercent } from "@/ui/format.ts";
import { ListRow } from "@/ui/history.tsx";
import { EmptyState, ErrorState, Loading, Page } from "@/ui/page.tsx";
import { Panel } from "@/ui/panel.tsx";
import { StatTile } from "@/ui/stat-tile.tsx";

type Day = NotebookOverview["days"][number];
const RANGES = { all: undefined, month: 30, week: 7 } as const;
type Range = keyof typeof RANGES;

/** What a day had: its date, then lesson work, cards and AI where there were any. */
function useDescribeDay(days: Day[]) {
  const { t } = useTranslation();
  const date = useDateFormat("day");
  const byStart = new Map(days.map((d) => [new Date(d.start).toDateString(), d]));
  return (start: number) => {
    const day = byStart.get(new Date(start).toDateString());
    const what = day
      ? (["lesson", "review", "ai"] as const)
          .filter((k) => day[k])
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
  return (
    <>
      <Panel title={t("notebook.progress")}>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <StatTile
            label={t("notebook.wordsKnown")}
            value={count(overview.wordsKnown)}
            note={t("notebook.wordsKnownHint")}
          />
          <StatTile label={t("notebook.lessonsDone")} value={count(overview.lessonsDone)} />
        </div>
      </Panel>
      <Panel title={t("notebook.days")}>
        <div className="mt-2">
          <ActivityCalendar
            today={overview.today}
            days={overview.days.map((d) => ({ start: d.start, count: d.lesson + d.review + d.ai }))}
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

export function NotebookPage() {
  const { t } = useTranslation();
  const notebook = useNotebook();
  const navigate = useNavigate();
  const when = useDateFormat("day");
  const percent = usePercent();
  if (notebook.isPending) return <Loading />;
  if (notebook.isError)
    return <ErrorState error={notebook.error} onRetry={() => notebook.refetch()} />;
  const { courses } = notebook.data;
  return (
    <Page title={t("notebook.title")}>
      <div className="max-w-3xl space-y-4">
        <Progress overview={notebook.data} />
        <h2 className="pt-2 text-lg font-semibold">{t("notebook.lessons")}</h2>
        {courses.length ? (
          courses.map((course) => (
            <Panel key={course.key} title={course.title ?? course.key}>
              <ul className="divide-y">
                {course.lessons.map((l) => {
                  const { courseId, name, unit, lesson } = parseLessonKey(l.key);
                  return (
                    <li key={l.key}>
                      <ListRow
                        onClick={() =>
                          void navigate({
                            to: "/notebook/$series/$course/$lesson",
                            params: { series: seriesOf(l.key), course: courseId, lesson: name },
                          })
                        }
                      >
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2">
                            {unit}.{lesson} {l.title}
                          </span>
                          <span className="block text-sm text-muted-foreground">
                            {t("notebook.passesCount", { count: l.passes })} ·{" "}
                            {l.open ? t("notebook.open") : when.format(l.lastAt)}
                          </span>
                        </span>
                        {l.best !== null && (
                          <span className="font-semibold tabular-nums text-correct">
                            {percent(l.best)}
                          </span>
                        )}
                      </ListRow>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ))
        ) : (
          <EmptyState>{t("notebook.empty")}</EmptyState>
        )}
      </div>
    </Page>
  );
}
