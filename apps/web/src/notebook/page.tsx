// The Notebook (09): progress first — words known and lessons done; the study days of the last year
// as a calendar, with the totals of all time, 30 or 7 days (lesson work, cards answered, new cards,
// the share remembered, AI practice); each language's review deck; then the journal by lesson (owner's choice A, 2026-10-07): the
// courses with the lessons worked on — passes, the best score, one still open — each opening its passes.
import { activityTotals, examPassed } from "@sprachanker/engine";
import { parseLessonKey, seriesOf } from "@sprachanker/schema";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type NotebookOverview, useNotebook } from "@/api/hooks.ts";
import { examParams } from "@/exams/params.ts";
import { languageName } from "@/i18n/index.ts";
import { ActivityCalendar } from "@/ui/activity-calendar.tsx";
import { Chip } from "@/ui/chip.tsx";
import { LanguageFlag } from "@/ui/flags.tsx";
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
      ? (["lesson", "exam", "review", "ai"] as const)
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
            days={overview.days.map((d) => ({
              start: d.start,
              count: d.lesson + d.exam + d.review + d.ai,
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

type Deck = NotebookOverview["decks"][number];

/** Review in the Notebook (owner, 2026-10-10: as lessons and exams have theirs): each language's deck —
 *  its words by state, what is due, the month's answers and how many were remembered — opening the
 *  decks. */
function ReviewDeck({ deck }: { deck: Deck }) {
  const { t, i18n } = useTranslation();
  const count = useNumber();
  const percent = usePercent();
  const navigate = useNavigate();
  const { words, due } = deck;
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <LanguageFlag lang={deck.language} />
          {languageName(deck.language, i18n.language, true)}
        </span>
      }
    >
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <StatTile label={t("myWords.state.new")} value={count(words.new)} />
        <StatTile label={t("myWords.state.learning")} value={count(words.learning)} />
        <StatTile label={t("myWords.state.review")} value={count(words.review)} />
        <StatTile
          label={t("notebook.review.mature")}
          value={count(words.mature)}
          note={t("notebook.review.matureHint")}
        />
        <StatTile label={t("myWords.state.suspended")} value={count(words.suspended)} />
        <StatTile
          label={t("notebook.review.remembered")}
          value={deck.remembered === undefined ? "—" : percent(deck.remembered)}
          note={t("notebook.review.month", { count: deck.answers })}
        />
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        {t("notebook.review.due", { today: due.today, tomorrow: due.tomorrow, week: due.week })}
      </p>
      <ul className="mt-2">
        <li>
          <ListRow onClick={() => void navigate({ to: "/review/decks" })}>
            <span className="flex-1">{t("notebook.review.open")}</span>
          </ListRow>
        </li>
      </ul>
    </Panel>
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
  const { courses, exams } = notebook.data;
  return (
    <Page title={t("notebook.title")}>
      <div className="max-w-3xl space-y-4">
        <Progress overview={notebook.data} />
        {notebook.data.decks.length > 0 && (
          <>
            <h2 className="pt-2 text-lg font-semibold">{t("notebook.review.title")}</h2>
            {notebook.data.decks.map((deck) => (
              <ReviewDeck key={deck.language} deck={deck} />
            ))}
          </>
        )}
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
        {exams.length > 0 && (
          <>
            <h2 className="pt-2 text-lg font-semibold">{t("notebook.exams")}</h2>
            {exams.map((exam) => (
              <Panel key={exam.key} title={exam.title ?? exam.key}>
                <ul className="divide-y">
                  {/* The latest three; the exam's page in the Notebook has them all. */}
                  {exam.runs.slice(0, 3).map((run) => {
                    const passed = examPassed(run.result);
                    return (
                      <li key={run.id}>
                        <ListRow
                          onClick={() =>
                            void navigate({
                              to: "/exam/$series/$course/$exam/run/$run",
                              params: { ...examParams(exam.key), run: run.id },
                            })
                          }
                        >
                          <span className="flex-1">
                            {when.format(run.finishedAt ?? run.startedAt)}
                          </span>
                          <span className="tabular-nums">
                            {t("exams.points", {
                              points: run.result?.points ?? 0,
                              max: run.result?.max ?? 0,
                            })}
                          </span>
                          <span
                            className={`w-24 text-right text-sm font-medium ${passed ? "text-correct" : "text-wrong"}`}
                          >
                            {/* A module taken alone without a pass mark of its own: its points only. */}
                            {passed !== undefined && t(passed ? "exams.passed" : "exams.failed")}
                          </span>
                        </ListRow>
                      </li>
                    );
                  })}
                  <li>
                    <ListRow
                      onClick={() =>
                        void navigate({
                          to: "/notebook/exam/$series/$course/$exam",
                          params: examParams(exam.key),
                        })
                      }
                    >
                      <span className="flex-1 text-sm font-medium">{t("notebook.examAll")}</span>
                    </ListRow>
                  </li>
                </ul>
              </Panel>
            ))}
          </>
        )}
      </div>
    </Page>
  );
}
