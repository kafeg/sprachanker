// Two passes of a lesson side by side (09): each exercise's first-try count in both, and the totals.
import { exerciseResults, firstTry, shownExercises } from "@sprachanker/engine";
import { useTranslation } from "react-i18next";
import { useNotebookPass } from "@/api/hooks.ts";
import { useDateFormat } from "@/ui/format.ts";
import { ErrorState, Loading } from "@/ui/page.tsx";
import { Panel } from "@/ui/panel.tsx";
import { cn } from "@/ui/utils.ts";
import { usePassMark } from "./mark.ts";

export function CompareView({ ids }: { ids: [string, string] }) {
  const { t } = useTranslation();
  const a = useNotebookPass(ids[0]);
  const b = useNotebookPass(ids[1]);
  const when = useDateFormat("dayTime");
  const mark = usePassMark();
  const failed = a.error ?? b.error;
  if (failed) return <ErrorState error={failed} />;
  if (!a.data || !b.data) return <Loading />;
  const passes = [a.data, b.data];
  const read = passes.map((p) => ({
    results: exerciseResults(p.events),
    shown: shownExercises(p.events, p.lesson, p.locale),
  }));
  // The exercises in the later pass's order, then any only the earlier one had.
  const keys = [
    ...new Set([...(read[1]?.shown ?? []), ...(read[0]?.shown ?? [])].map((s) => s.exercise.key)),
  ];
  const cell = (side: number, key: string) => {
    const r = read[side];
    const shown = r?.shown.find((s) => s.exercise.key === key);
    if (!shown || !r?.results[key]) return <span className="text-muted-foreground">—</span>;
    const first = firstTry(shown.exercise, r.results[key]);
    if (!first.scored) return <span className="text-muted-foreground">✓</span>;
    return (
      <span className={cn(first.correct === first.scored ? "text-correct" : "text-wrong")}>
        {first.correct}/{first.scored}
      </span>
    );
  };
  const grid = "grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] items-center gap-2 py-2";
  return (
    <Panel className="max-w-3xl">
      <div className={cn(grid, "border-b text-xs text-muted-foreground")}>
        <span>{t("notebook.exercise")}</span>
        {passes.map((p) => (
          <span key={p.run.id} className="text-right">
            {when.format(p.run.startedAt)}
          </span>
        ))}
      </div>
      <ul className="divide-y">
        {keys.map((key) => {
          const shown = [read[1], read[0]]
            .flatMap((r) => r?.shown ?? [])
            .find((s) => s.exercise.key === key);
          return (
            <li key={key} className={grid}>
              <span className="line-clamp-2">
                {shown?.locale?.title || t("lesson.exerciseN", { n: (shown?.pageIndex ?? 0) + 1 })}
              </span>
              <span className="text-right tabular-nums">{cell(0, key)}</span>
              <span className="text-right tabular-nums">{cell(1, key)}</span>
            </li>
          );
        })}
        <li className={cn(grid, "font-semibold")}>
          <span>{t("notebook.total")}</span>
          {passes.map((p) => (
            <span key={p.run.id} className="text-right tabular-nums">
              {mark(p.run)}
            </span>
          ))}
        </li>
      </ul>
    </Panel>
  );
}
