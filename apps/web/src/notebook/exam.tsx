// An exam in the Notebook (09; owner, 2026-10-10: an exam's statistics belong here, as a course's do),
// as the exams module gives it (schema `EntryDetail`): its mock exams and practice runs, newest first —
// when, the points, passed or not — each opening its result; the map of the questions open to the
// learner (known, answered wrongly last time, not seen); and the questions answered wrongly last time.
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useNotebookExam } from "@/api/notebook.ts";
import { type ExamParams, examKeyOf, questionNumber } from "@/library/exam-address.ts";
import { inLang } from "@/ui/direction.tsx";
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
  const { entry, items, lang, modules = false } = detail.data;
  const known = items.filter((i) => i.state === "right").length;
  const wrong = items.filter((i) => i.state === "wrong");
  // A question by its number as the catalogue gives it (its Teil named beside it), never by its key.
  const number = (i: (typeof items)[number]) => questionNumber(i.key, modules);
  const nameOf = (i: (typeof items)[number]) => [i.group, number(i)].filter(Boolean).join(" · ");
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
                  title={nameOf(i)}
                  className={cn("aspect-square rounded-[3px]", SHADE[i.state])}
                />
              ))}
            </div>
          </Panel>
        )}

        {wrong.length > 0 && (
          <Panel title={t("notebook.examWrong", { count: wrong.length })}>
            <ul>
              {wrong.map((i, n) => (
                <li key={i.key} className="text-sm">
                  {/* Its Teil named where the list comes to it (an exam of several). */}
                  {i.group && i.group !== wrong[n - 1]?.group && (
                    <p className="pt-3 pb-1 text-xs font-medium text-muted-foreground">{i.group}</p>
                  )}
                  <span className="flex gap-3 border-t py-2">
                    <span className="min-w-8 shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">
                      {number(i)}
                    </span>
                    <span {...inLang(lang)} className="min-w-0 flex-1 break-words">
                      {i.line || number(i)}
                    </span>
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
