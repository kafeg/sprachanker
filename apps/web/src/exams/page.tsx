// An exam's page (09, Exams; owner's choice 2A, 2026-10-10): how ready the learner is (a ring), the
// federal state its questions are asked of, the whole exam or one module, the three ways in as tiles —
// a mock exam as the real test runs it, practice with each answer checked at once, the catalogue of
// every question with its answer — and the latest mock exam, the way to the rest in the Notebook.
import { missingSettings, questionCount, settingOf, timeOf } from "@sprachanker/engine";
import type { ExamMode } from "@sprachanker/schema";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, BookOpenCheck, Dumbbell, Timer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEdition } from "@/api/edition.ts";
import { useExamPage, useExams, useStartExam } from "@/api/exams.ts";
import { useSettings } from "@/api/hooks.ts";
import { PublisherLink } from "@/courses/card.tsx";
import { type ExamParams, examKeyOf } from "@/library/exam-address.ts";
import { Choice } from "@/ui/choice.tsx";
import { Button } from "@/ui/components/button.tsx";
import { errorText } from "@/ui/error-text.ts";
import { useDateFormat, usePercent } from "@/ui/format.ts";
import { ListRow } from "@/ui/history.tsx";
import { BackLink, ErrorState, Loading, NotInstalled, Page } from "@/ui/page.tsx";
import { ProgressRing } from "@/ui/progress-ring.tsx";
import { cn } from "@/ui/utils.ts";
import { ExamSourcesPanel } from "./sources.tsx";
import { StateSelect } from "./state-select.tsx";

export function ExamPage({ params, start }: { params: ExamParams; start?: ExamMode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const key = examKeyOf(params);
  const exams = useExams();
  const row = exams.data?.find((e) => e.key === key);
  const edition = useEdition(params.series, params.course, row?.editions);
  const page = useExamPage(key, edition);
  const settings = useSettings();
  const begin = useStartExam();
  const percent = usePercent();
  const date = useDateFormat("day");
  // An exam of modules: the whole of it, or one module (Goethe B1's are taken apart).
  const [module, setModule] = useState("");

  /** Begins a run and opens it; begun from a card's `?start=`, the run takes this page's place in
   *  the history, so Back does not begin another. */
  const go = (mode: ExamMode, replace = false) => {
    if (!edition) return;
    begin.mutate(
      { exam: key, edition, mode, ...(module && { module }) },
      {
        onSuccess: ({ run }) =>
          void navigate({
            to: "/exam/$series/$course/$exam/run/$run",
            params: { ...params, run: run.id },
            replace,
          }),
      },
    );
  };
  const setting = settingOf((k) => settings.data?.[k as keyof typeof settings.data]);
  // The settings still to choose, read from the settings as they are now (a state just chosen).
  const needs = page.data ? missingSettings(page.data.exam, setting) : [];
  // Asked from a card (`?start=`): begun at once, unless the state is still to be chosen.
  const asked = useRef(false);
  useEffect(() => {
    if (start && page.data && !needs.length && !asked.current) {
      asked.current = true;
      go(start, true);
    }
  });

  if (exams.isPending || (row && (!edition || page.isPending))) return <Loading />;
  if (exams.isError) return <ErrorState error={exams.error} onRetry={() => exams.refetch()} />;
  if (!row) return <NotInstalled />;
  if (page.isError) return <ErrorState error={page.error} onRetry={() => page.refetch()} />;
  const data = page.data;
  if (!data) return <Loading />;

  const { exam, locale } = data;
  const title = locale?.title ?? row.titles[edition ?? ""] ?? key;
  const asks = exam.sections
    .filter((s) => !module || s.module === module)
    .reduce((n, s) => n + s.draw, 0);
  const minutes = Math.round(timeOf(exam, module || undefined) / 60);
  const askedOfState = exam.sections.some((s) => s.filter?.setting === "exam.federalState");
  const testRunning = data.active?.plan.mode === "test" ? data.active : undefined;
  const toRun = (run: string) =>
    void navigate({ to: "/exam/$series/$course/$exam/run/$run", params: { ...params, run } });

  return (
    <Page
      back={<BackLink onClick={() => void navigate({ to: "/exams" })}>{t("nav.exams")}</BackLink>}
    >
      <section className="mb-6 rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-4 sm:gap-5">
          <ProgressRing value={data.readiness} text={percent(data.readiness)} />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold leading-tight sm:text-4xl">{title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              {row.source && (
                <span className="flex min-w-0 max-w-full rounded-full border px-2.5 py-0.5 text-muted-foreground">
                  <PublisherLink source={row.source} />
                </span>
              )}
              {askedOfState && <StateSelect className="w-auto min-w-44 max-w-full rounded-full" />}
            </div>
          </div>
        </div>
        {needs.length > 0 && (
          <p role="status" className="mt-4 rounded-xl bg-accent px-4 py-3 text-sm">
            {t("exams.needsState")}
          </p>
        )}
        {begin.isError && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {errorText(t, begin.error)}
          </p>
        )}
      </section>

      {exam.modules && (
        <div className="mb-3">
          <Choice
            value={module}
            options={[
              ["", t("exams.wholeExam")],
              ...exam.modules.map((m): [string, string] => [
                m.id,
                locale?.modules?.[m.id]?.title ?? m.id,
              ]),
            ]}
            onChange={setModule}
          />
        </div>
      )}
      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <ModeTile
          icon={<Timer className="size-5" />}
          title={t("exams.mode.test")}
          text={t("exams.mode.testText", { count: asks, minutes })}
          primary
        >
          {testRunning ? (
            <Button className="w-full" onClick={() => toRun(testRunning.id)}>
              {t("exams.continueTest")} <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button
              className="w-full"
              disabled={needs.length > 0}
              loading={begin.isPending && begin.variables?.mode === "test"}
              onClick={() => go("test")}
            >
              {t("exams.begin")} <ArrowRight className="size-4" />
            </Button>
          )}
        </ModeTile>
        <ModeTile
          icon={<Dumbbell className="size-5" />}
          title={t("exams.mode.practice")}
          text={t("exams.mode.practiceText")}
        >
          <Button
            variant="outline"
            className="w-full"
            disabled={needs.length > 0 || !!testRunning}
            title={testRunning ? t("error.exam_test_running") : undefined}
            loading={begin.isPending && begin.variables?.mode === "practice"}
            onClick={() => go("practice")}
          >
            {t("exams.practise")}
          </Button>
        </ModeTile>
        <ModeTile
          icon={<BookOpenCheck className="size-5" />}
          title={t("exams.mode.catalog")}
          text={t("exams.mode.catalogText", { count: questionCount(exam) })}
        >
          <Button asChild variant="outline" className="w-full">
            <Link to="/exam/$series/$course/$exam/catalog" params={params}>
              {t("exams.openCatalog")}
            </Link>
          </Button>
        </ModeTile>
      </div>

      {/* The latest mock exam; the rest of what was done is the Notebook's. */}
      <section className="overflow-hidden rounded-2xl border bg-card">
        <ListRow
          flush
          onClick={() => void navigate({ to: "/notebook/exam/$series/$course/$exam", params })}
        >
          <span className="flex-1">
            {data.last
              ? t("exams.lastResult", {
                  date: date.format(data.last.finishedAt ?? data.last.startedAt),
                  points: data.last.result?.points ?? 0,
                  max: data.last.result?.max ?? 0,
                })
              : t("exams.noResultYet")}
          </span>
          <span className="text-sm font-medium text-muted-foreground">{t("exams.inNotebook")}</span>
        </ListRow>
      </section>
      {data.sources && <ExamSourcesPanel sources={data.sources} />}
    </Page>
  );
}

function ModeTile({
  icon,
  title,
  text,
  primary,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl border bg-card p-4",
        primary && "border-2 border-primary",
      )}
    >
      <h2 className="flex items-center gap-2 font-heading text-lg font-bold">
        {icon} {title}
      </h2>
      <p className="mt-1 mb-4 flex-1 text-sm text-muted-foreground">{text}</p>
      {children}
    </div>
  );
}
