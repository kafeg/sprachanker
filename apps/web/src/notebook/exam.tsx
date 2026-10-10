// An exam in the Notebook (09; owner, 2026-10-10: an exam's statistics belong here, as a course's do):
// its mock exams and practice runs, newest first — when, the points, passed or not — each opening its
// result; the map of the questions open to the learner (known, answered wrongly last time, not seen);
// and the questions answered wrongly last time.
import { examPassed, openQuestions, questionLine, settingOf } from "@sprachanker/engine";
import { examLang } from "@sprachanker/schema";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useEdition } from "@/api/edition.ts";
import { useExamPage, useExams } from "@/api/exams.ts";
import { useSettings } from "@/api/hooks.ts";
import { type ExamParams, examKeyOf } from "@/exams/params.ts";
import { useDateFormat } from "@/ui/format.ts";
import { ListRow } from "@/ui/history.tsx";
import { BackLink, EmptyState, ErrorState, Loading, NotInstalled, Page } from "@/ui/page.tsx";
import { Panel } from "@/ui/panel.tsx";
import { cn } from "@/ui/utils.ts";

export function ExamNotebook({ params }: { params: ExamParams }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const key = examKeyOf(params);
  const exams = useExams();
  const row = exams.data?.find((e) => e.key === key);
  const edition = useEdition(params.series, params.course, row?.editions);
  const page = useExamPage(key, edition);
  const settings = useSettings();
  const when = useDateFormat("dayTime");

  if (exams.isPending || (row && (!edition || page.isPending))) return <Loading />;
  if (exams.isError) return <ErrorState error={exams.error} onRetry={() => exams.refetch()} />;
  if (!row) return <NotInstalled />;
  if (page.isError) return <ErrorState error={page.error} onRetry={() => page.refetch()} />;
  const data = page.data;
  if (!data) return <Loading />;

  const setting = settingOf((k) => settings.data?.[k as keyof typeof settings.data]);
  const open = openQuestions(data.exam, setting);
  const stat = (k: string) => data.stats[k]?.last;
  const known = open.filter((i) => stat(i.key) === "right").length;
  const wrong = open.filter((i) => stat(i.key) === "wrong");
  const title = data.locale?.title ?? row.titles[edition ?? ""] ?? key;
  const lang = examLang(edition);
  const toRun = (run: string) =>
    void navigate({ to: "/exam/$series/$course/$exam/run/$run", params: { ...params, run } });

  return (
    <Page
      title={title}
      back={
        <BackLink onClick={() => void navigate({ to: "/notebook" })}>
          {t("notebook.title")}
        </BackLink>
      }
    >
      <div className="space-y-6">
        <Panel title={t("notebook.examRuns")}>
          {data.runs.length ? (
            <ul className="divide-y">
              {data.runs.map((run) => {
                const passed = run.plan.mode === "test" ? examPassed(run.result) : undefined;
                return (
                  <li key={run.id}>
                    <ListRow onClick={() => toRun(run.id)}>
                      <span className="flex-1">
                        {when.format(run.finishedAt ?? run.startedAt)}
                        <span className="ml-2 text-sm text-muted-foreground">
                          {t(run.plan.mode === "test" ? "exams.mode.test" : "exams.mode.practice")}
                          {run.plan.module &&
                            ` · ${data.locale?.modules?.[run.plan.module]?.title ?? run.plan.module}`}
                        </span>
                      </span>
                      <span className="tabular-nums">
                        {t("exams.points", {
                          points: run.result?.points ?? 0,
                          max: run.result?.max ?? 0,
                        })}
                      </span>
                      <span
                        className={cn(
                          "w-24 text-right text-sm font-medium",
                          passed ? "text-correct" : "text-wrong",
                        )}
                      >
                        {passed !== undefined && t(passed ? "exams.passed" : "exams.failed")}
                      </span>
                    </ListRow>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState>{t("notebook.noExamRuns")}</EmptyState>
          )}
        </Panel>

        {open.length > 0 && (
          <Panel title={t("exams.mapTitle")}>
            <p className="mb-2 text-sm text-muted-foreground">
              {t("exams.known", { known, total: open.length })}
            </p>
            <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <Legend className="bg-correct" label={t("exams.mapKnown")} />
              <Legend className="bg-wrong" label={t("exams.mapWrong")} />
              <Legend className="bg-muted" label={t("exams.mapUnseen")} />
            </div>
            <div
              role="img"
              aria-label={t("exams.mapSummary", { known, wrong: wrong.length, total: open.length })}
              className="grid grid-cols-[repeat(auto-fill,minmax(0.6rem,1fr))] gap-[3px]"
            >
              {open.map((i) => (
                <span
                  key={i.key}
                  title={i.key.split("/q-")[1]}
                  className={cn(
                    "aspect-square rounded-[3px]",
                    stat(i.key) === "right"
                      ? "bg-correct"
                      : stat(i.key) === "wrong"
                        ? "bg-wrong"
                        : "bg-muted",
                  )}
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
                    {i.key.split("/q-")[1]}
                  </span>
                  <span lang={lang} className="min-w-0 flex-1">
                    {questionLine(i) || i.key}
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
