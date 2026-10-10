// An exam in the Notebook (09; owner, 2026-10-10: an exam's statistics belong here, as a course's do),
// as the exams module gives it (schema `EntryDetail`): its mock exams and practice runs, newest first —
// when, the points, passed or not — each opening its result; the map of the questions open to the
// learner (known, answered wrongly last time, not seen); and the questions answered wrongly last time.
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useNotebookExam } from "@/api/hooks.ts";
import { type ExamParams, examKeyOf } from "@/library/exam-address.ts";
import { BackLink, EmptyState, ErrorState, Loading, Page } from "@/ui/page.tsx";
import { Panel } from "@/ui/panel.tsx";
import { cn } from "@/ui/utils.ts";
import { RunRow } from "./standing.tsx";

const SHADE = { right: "bg-correct", wrong: "bg-wrong", unseen: "bg-muted" } as const;

export function ExamNotebook({ params }: { params: ExamParams }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const key = examKeyOf(params);
  const detail = useNotebookExam(key);

  if (detail.isPending) return <Loading />;
  if (detail.isError) return <ErrorState error={detail.error} onRetry={() => detail.refetch()} />;
  const { entry, items, lang } = detail.data;
  const known = items.filter((i) => i.state === "right").length;
  const wrong = items.filter((i) => i.state === "wrong");
  /** A question's number in its exam ("Q-12" of its key). */
  const numberOf = (k: string) => k.split("/q-")[1];
  const toRun = (run: string) =>
    void navigate({ to: "/exam/$series/$course/$exam/run/$run", params: { ...params, run } });

  return (
    <Page
      title={entry.title ?? key}
      back={
        <BackLink onClick={() => void navigate({ to: "/notebook" })}>
          {t("notebook.title")}
        </BackLink>
      }
    >
      <div className="space-y-6">
        <Panel title={t("notebook.examRuns")}>
          {entry.runs.length ? (
            <ul className="divide-y">
              {entry.runs.map((run) => (
                <li key={run.id}>
                  <RunRow
                    run={run}
                    kind={t(run.mode === "test" ? "exams.mode.test" : "exams.mode.practice")}
                    onOpen={() => toRun(run.id)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>{t("notebook.noExamRuns")}</EmptyState>
          )}
        </Panel>

        {items.length > 0 && (
          <Panel title={t("exams.mapTitle")}>
            <p className="mb-2 text-sm text-muted-foreground">
              {t("exams.known", { known, total: items.length })}
            </p>
            <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <Legend className={SHADE.right} label={t("exams.mapKnown")} />
              <Legend className={SHADE.wrong} label={t("exams.mapWrong")} />
              <Legend className={SHADE.unseen} label={t("exams.mapUnseen")} />
            </div>
            <div
              role="img"
              aria-label={t("exams.mapSummary", {
                known,
                wrong: wrong.length,
                total: items.length,
              })}
              className="grid grid-cols-[repeat(auto-fill,minmax(0.6rem,1fr))] gap-[3px]"
            >
              {items.map((i) => (
                <span
                  key={i.key}
                  title={numberOf(i.key)}
                  className={cn("aspect-square rounded-[3px]", SHADE[i.state])}
                />
              ))}
            </div>
          </Panel>
        )}

        {wrong.length > 0 && (
          <Panel title={t("notebook.examWrong", { count: wrong.length })}>
            <ul className="divide-y">
              {wrong.map((i) => (
                <li key={i.key} className="flex gap-3 py-2 text-sm">
                  <span className="w-14 shrink-0 tabular-nums text-muted-foreground">
                    {numberOf(i.key)}
                  </span>
                  <span lang={lang} className="min-w-0 flex-1">
                    {i.line || i.key}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </Page>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("size-2.5 rounded-[3px]", className)} /> {label}
    </span>
  );
}
