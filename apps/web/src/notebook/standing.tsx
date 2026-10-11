// A module's standing as the Notebook shows every module's (schema `stats.ts`): its figures as tiles,
// its entries in the module's panel — those listed under a group (a lesson under its course) as rows
// under the group's title, the others (an exam, a language's deck) each under its own title with its
// figures, its latest runs and the way to it. What a module adds is its entries' titles and where they open (`EntryView`).
import type { Figure, ModuleId, RunSummary, StandingEntry } from "@sprachanker/schema";
import { useTranslation } from "react-i18next";
import { useDateFormat, useNumber, usePercent } from "@/ui/format.ts";
import { ListRow } from "@/ui/history.tsx";
import { Panel } from "@/ui/panel.tsx";
import { StatTile } from "@/ui/stat-tile.tsx";
import { cn } from "@/ui/utils.ts";

/** What a module adds to its entries: a title (else the entry's own), where an entry and one of its
 *  runs open. */
export interface EntryView {
  title?(entry: StandingEntry): React.ReactNode;
  open?(entry: StandingEntry): void;
  openRun?(entry: StandingEntry, run: RunSummary): void;
}

/** A figure as a tile: its label and note by the module and its id. */
export function FigureTile({ module, figure }: { module: ModuleId; figure: Figure }) {
  const { t, i18n } = useTranslation();
  const count = useNumber();
  const percent = usePercent();
  const key = `notebook.figure.${module}.${figure.id}`;
  const note = i18n.exists(`${key}Hint`)
    ? t(`${key}Hint`, { count: figure.count ?? 0 })
    : undefined;
  return (
    <StatTile
      label={t(key)}
      value={
        figure.value === null ? "—" : figure.share ? percent(figure.value) : count(figure.value)
      }
      note={note}
    />
  );
}

function FigureGrid({ module, figures }: { module: ModuleId; figures: Figure[] }) {
  if (!figures.length) return null;
  return (
    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {figures.map((f) => (
        <FigureTile key={f.id} module={module} figure={f} />
      ))}
    </div>
  );
}

/** A module's section, a panel as the page's others: its title, then its entries by group, or each on
 *  its own; none yet, what will come here. */
export function StandingSection({
  module,
  entries,
  view,
}: {
  module: ModuleId;
  entries: StandingEntry[];
  view: EntryView;
}) {
  const { t } = useTranslation();
  // Groups in the order their first entry comes; an entry without one stands alone.
  const blocks: Array<{ key: string; title: string | null; entries: StandingEntry[] }> = [];
  for (const entry of entries) {
    const at = entry.group && blocks.find((b) => b.key === entry.group?.key);
    if (at) at.entries.push(entry);
    else if (entry.group)
      blocks.push({ key: entry.group.key, title: entry.group.title, entries: [entry] });
    else blocks.push({ key: entry.key, title: null, entries: [entry] });
  }
  return (
    <Panel title={t(`notebook.section.${module}`)}>
      {/* Nothing yet: what comes here, so the page explains itself. */}
      {!entries.length && (
        <p className="text-sm text-muted-foreground">{t(`notebook.none.${module}`)}</p>
      )}
      {blocks.map((b) => (
        <div
          key={b.key}
          className="mt-3 border-t pt-3 first-of-type:mt-1 first-of-type:border-t-0 first-of-type:pt-0"
        >
          {b.entries[0]?.group ? (
            <>
              <h4 className="mt-2 font-sans font-medium text-muted-foreground">
                {b.title ?? b.key}
              </h4>
              <ul className="divide-y">
                {b.entries.map((e) => (
                  <li key={e.key}>
                    <EntryRow module={module} entry={e} view={view} />
                  </li>
                ))}
              </ul>
            </>
          ) : (
            b.entries.map((e) => <EntryBlock key={e.key} module={module} entry={e} view={view} />)
          )}
        </div>
      ))}
    </Panel>
  );
}

/** An entry as a row of its group: its title, its runs and when it was last worked on (or that a run
 *  is open), its first share (a lesson's best score). */
function EntryRow({
  module,
  entry,
  view,
}: {
  module: ModuleId;
  entry: StandingEntry;
  view: EntryView;
}) {
  const { t } = useTranslation();
  const when = useDateFormat("day");
  const percent = usePercent();
  const share = entry.figures.find((f) => f.share && f.value !== null);
  return (
    <ListRow onClick={() => view.open?.(entry)}>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2">{view.title?.(entry) ?? entry.title ?? entry.key}</span>
        <span className="block text-sm text-muted-foreground">
          {t(`notebook.runs.${module}`, { count: entry.runCount })} ·{" "}
          {entry.open ? t("notebook.open") : when.format(entry.lastAt)}
        </span>
      </span>
      {share && (
        <span
          className="font-semibold tabular-nums text-correct"
          title={t(`notebook.figure.${module}.${share.id}`)}
        >
          {percent(share.value as number)}
        </span>
      )}
    </ListRow>
  );
}

/** An entry on its own: its title, its figures, its latest runs, and the way to it. */
function EntryBlock({
  module,
  entry,
  view,
}: {
  module: ModuleId;
  entry: StandingEntry;
  view: EntryView;
}) {
  const { t } = useTranslation();
  return (
    <>
      <h4 className="mt-2 font-sans font-medium text-muted-foreground">
        {view.title?.(entry) ?? entry.title ?? entry.key}
      </h4>
      <FigureGrid module={module} figures={entry.figures} />
      <ul className={cn("divide-y", entry.figures.length > 0 && "mt-2")}>
        {entry.runs.map((run) => (
          <li key={run.id}>
            <RunRow run={run} onOpen={() => view.openRun?.(entry, run)} />
          </li>
        ))}
        {view.open && (
          <li>
            <ListRow onClick={() => view.open?.(entry)}>
              <span className="flex-1 text-sm font-medium">
                {t(`notebook.openEntry.${module}`)}
              </span>
            </ListRow>
          </li>
        )}
      </ul>
    </>
  );
}

/** A run in a list: when it ended, what kind it was and the part taken (when told), the points it
 *  scored, passed or not. */
export function RunRow({
  run,
  kind,
  onOpen,
}: {
  run: RunSummary;
  /** What kind of run it was, in words. */
  kind?: string;
  onOpen(): void;
}) {
  const { t } = useTranslation();
  const when = useDateFormat(kind ? "dayTime" : "day");
  return (
    <ListRow onClick={onOpen}>
      <span className="flex-1">
        {when.format(run.finishedAt ?? run.startedAt)}
        {kind && (
          <span className="ms-2 text-sm text-muted-foreground">
            {kind}
            {run.part && ` · ${run.part}`}
          </span>
        )}
      </span>
      <span className="tabular-nums">
        {run.points !== undefined && t("exams.points", { points: run.points, max: run.max ?? 0 })}
      </span>
      <span
        className={cn(
          "w-24 text-end text-sm font-medium",
          run.passed ? "text-correct" : "text-wrong",
        )}
      >
        {/* A run no pass mark judges (a module taken alone without one): its points only. */}
        {run.passed !== undefined && t(run.passed ? "exams.passed" : "exams.failed")}
      </span>
    </ListRow>
  );
}
