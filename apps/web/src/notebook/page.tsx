// The Notebook (09), by lesson (owner's choice A, 2026-10-07): the last study days as a strip, then the
// courses with the lessons worked on — passes, the best score, one still open — each opening its passes.
import { parseLessonKey, seriesOf } from "@sprachanker/schema";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { type NotebookOverview, useNotebook } from "@/api/hooks.ts";
import { EmptyState, ErrorState, Loading, Page } from "@/ui/app-shell.tsx";
import { useDateFormat, usePercent } from "@/ui/format.ts";
import { ListRow } from "@/ui/history.tsx";
import { Panel } from "@/ui/panel.tsx";
import { cn } from "@/ui/utils.ts";

/** How much was done on a day, as a shade of the strip. */
const shade = (count: number) =>
  count === 0
    ? "bg-muted"
    : count < 10
      ? "bg-correct/30"
      : count < 30
        ? "bg-correct/60"
        : "bg-correct";

function Days({ days }: { days: NotebookOverview["days"] }) {
  const { t } = useTranslation();
  const day = useDateFormat("day");
  return (
    <Panel title={t("notebook.days")}>
      <ol className="mt-2 grid grid-cols-14 gap-1">
        {days.map((d) => {
          const label = t("notebook.dayTitle", { date: day.format(d.start), count: d.count });
          return (
            <li
              key={d.start}
              title={label}
              aria-label={label}
              className={cn("h-6 rounded", shade(d.count))}
            />
          );
        })}
      </ol>
      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span>{day.format(days[0]?.start ?? 0)}</span>
        <span>{t("notebook.today")}</span>
      </div>
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
  const { days, courses } = notebook.data;
  return (
    <Page title={t("notebook.title")}>
      <div className="max-w-3xl space-y-4">
        <Days days={days} />
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
                          <span className="block truncate">
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
