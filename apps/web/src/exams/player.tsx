// An exam run (09, Exams; owner's choice 3B, 2026-10-10): its questions as one list, as a lesson's
// exercise shows its items. A mock exam runs as the real test does — the time left above, answers that
// can be changed until it is handed in, nothing checked before (then the result, 4B); practice checks
// each answer at once and brings the next questions on request.
import { checkQuestion } from "@sprachanker/engine";
import { type ExamItem, type Outcome, parseEditionId, type TypedEvent } from "@sprachanker/schema";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Timer } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { mediaUrl } from "@/api/client.ts";
import { useExamPage, useExamRun } from "@/api/exams.ts";
import { ItemCard } from "@/exercises/item-card.tsx";
import { Button } from "@/ui/components/button.tsx";
import { ConfirmDialog } from "@/ui/confirm.tsx";
import { ErrorState, Loading } from "@/ui/page.tsx";
import { TargetLang } from "@/ui/target-lang.ts";
import { useWindowPlace } from "@/ui/window-title.ts";
import { type ExamParams, examKeyOf } from "./params.ts";
import { asExercise, latestAnswers } from "./questions.ts";
import { ExamResultView } from "./result.tsx";

/** Questions practice shows at a time; more on request. */
const PRACTICE_BATCH = 10;

export function ExamPlayer({ params, runId }: { params: ExamParams; runId: string }) {
  const navigate = useNavigate();
  const key = examKeyOf(params);
  const { query, answer, finish } = useExamRun(runId);
  const run = query.data?.run;
  const page = useExamPage(key, run?.edition ?? undefined);
  const toExam = () => void navigate({ to: "/exam/$series/$course/$exam", params });

  if (query.isPending || (run && page.isPending)) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (page.isError) return <ErrorState error={page.error} onRetry={() => page.refetch()} />;
  if (!run || !page.data) return <Loading />;
  const target = run.edition ? parseEditionId(run.edition).target : "de";
  const exam = page.data.exam;
  // A mock exam's questions as they were shown; practice's as installed now.
  const items =
    run.plan.snapshot ?? run.plan.items.flatMap((k) => exam.items.find((i) => i.key === k) ?? []);
  const title = page.data.locale?.title ?? key;
  return (
    <TargetLang value={target}>
      {run.status === "active" ? (
        <Running
          title={title}
          items={items}
          events={query.data?.events ?? []}
          mode={run.plan.mode}
          deadline={run.plan.deadline}
          skew={query.data?.skew ?? 0}
          sections={exam.sections.map((s) => ({
            key: s.key,
            title: page.data?.locale?.sections[s.key]?.title ?? "",
            items: s.pool,
          }))}
          series={params.series}
          lang={target}
          onAnswer={answer}
          finishing={finish.isPending}
          onFinish={() => finish.mutate()}
          onLeave={toExam}
        />
      ) : (
        <ExamResultView
          title={title}
          params={params}
          run={run}
          exam={exam}
          locale={page.data.locale}
          items={items}
          events={query.data?.events ?? []}
          onLeave={toExam}
        />
      )}
    </TargetLang>
  );
}

/** Minutes and seconds left ("41:12"). */
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function Running({
  title,
  items,
  events,
  mode,
  deadline,
  skew,
  sections,
  series,
  lang,
  onAnswer,
  finishing,
  onFinish,
  onLeave,
}: {
  title: string;
  items: ExamItem[];
  events: TypedEvent[];
  mode: "test" | "practice";
  deadline: number | null;
  /** The server's clock ahead of this device's (ms): the deadline is the server's. */
  skew: number;
  sections: Array<{ key: string; title: string; items: string[] }>;
  series: string;
  lang: string;
  onAnswer(itemKey: string, answer: unknown, ms: number, outcome?: Outcome): void;
  finishing: boolean;
  onFinish(): void;
  onLeave(): void;
}) {
  const { t } = useTranslation();
  useWindowPlace(title);
  const answers = useMemo(() => latestAnswers(events), [events]);
  const exercise = useMemo(() => asExercise(title, items), [title, items]);
  const [confirm, setConfirm] = useState(false);
  const shownAt = useRef(Date.now());
  // Practice: the questions answered here stay, the next ones come in batches.
  const [batch, setBatch] = useState(PRACTICE_BATCH);
  let unanswered = 0;
  const shown =
    mode === "test" ? items : items.filter((i) => answers.has(i.key) || unanswered++ < batch);
  const answered = items.filter((i) => answers.has(i.key)).length;

  // The time left, each second; at its end the exam is handed in as it is.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (deadline === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  const left = deadline === null ? undefined : deadline - (now + skew);
  const handedIn = useRef(false);
  useEffect(() => {
    if (left !== undefined && left <= 0 && !handedIn.current) {
      handedIn.current = true;
      onFinish();
    }
  }, [left, onFinish]);

  const finishLabel = mode === "test" ? t("exams.handIn") : t("exams.endPractice");
  const askFinish = () =>
    mode === "test" && answered < items.length ? setConfirm(true) : onFinish();

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-2 border-r bg-sidebar p-4 lg:flex">
        <button
          type="button"
          onClick={onLeave}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> {title}
        </button>
        <h2 className="mt-3 font-heading text-lg font-bold">
          {t(mode === "test" ? "exams.mode.test" : "exams.mode.practice")}
        </h2>
        {left !== undefined && (
          <p className="flex items-center gap-1.5 font-heading text-2xl font-bold tabular-nums">
            <Timer className="size-5" /> {clock(left)}
          </p>
        )}
        <ul className="mt-2 space-y-1 text-sm">
          {sections
            .map((s) => ({ ...s, own: items.filter((i) => s.items.includes(i.key)) }))
            .filter((s) => s.own.length)
            .map((s) => (
              <li key={s.key} className="flex justify-between gap-2 rounded-lg px-2 py-1.5">
                <span className="min-w-0 truncate">{s.title}</span>
                <span className="tabular-nums text-muted-foreground">
                  {s.own.filter((i) => answers.has(i.key)).length}/{s.own.length}
                </span>
              </li>
            ))}
        </ul>
        <div className="mt-auto space-y-2">
          <p className="text-sm text-muted-foreground">
            {t("exams.answered", { done: answered, total: items.length })}
          </p>
          <Button className="w-full" loading={finishing} onClick={askFinish}>
            {finishLabel}
          </Button>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-10 flex min-h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={onLeave}
            aria-label={t("exams.leave")}
            className="-ml-1 p-2"
          >
            <ArrowLeft className="size-5" />
          </button>
          <span className="text-sm tabular-nums text-muted-foreground">
            {answered}/{items.length}
          </span>
          {left !== undefined && (
            <span className="ml-auto flex items-center gap-1 font-heading text-lg font-bold tabular-nums">
              <Timer className="size-4" /> {clock(left)}
            </span>
          )}
        </header>
        <main className="mx-auto max-w-3xl px-4 pt-6 pb-28 sm:px-6 lg:pb-12">
          <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
            {t(mode === "test" ? "exams.mode.test" : "exams.mode.practice")}
          </p>
          <h1 className="mb-1 text-3xl font-bold">{title}</h1>
          <p className="mb-6 text-muted-foreground">
            {t(mode === "test" ? "exams.testHint" : "exams.practiceHint")}
          </p>
          <ol aria-label={t("lesson.itemsList")} className="space-y-6">
            {shown.map((item) => {
              const index = items.indexOf(item);
              const given = answers.get(item.key);
              return (
                <li key={item.key}>
                  <p className="mb-1.5 text-sm text-muted-foreground">
                    {t("exams.question", { n: index + 1, total: items.length })}
                  </p>
                  <ItemCard
                    exercise={exercise}
                    locale={null}
                    index={index}
                    answer={given?.answer}
                    // Practice shows each answer checked; a mock exam none until handed in.
                    outcome={mode === "practice" ? given?.outcome : undefined}
                    url={(path) => mediaUrl(series, path)}
                    onAnswer={
                      mode === "practice" && given
                        ? undefined
                        : (value) => {
                            const ms = Date.now() - shownAt.current;
                            onAnswer(
                              item.key,
                              value,
                              ms,
                              mode === "practice" ? checkQuestion(item, value, lang) : undefined,
                            );
                          }
                    }
                  />
                </li>
              );
            })}
          </ol>
          {mode === "practice" && shown.length < items.length && (
            <Button
              variant="outline"
              className="mt-6 w-full"
              onClick={() => setBatch((n) => n + PRACTICE_BATCH)}
            >
              {t("exams.moreQuestions")}
            </Button>
          )}
        </main>
        <footer className="fixed inset-x-0 bottom-0 z-10 flex items-center gap-3 border-t bg-background/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
          <span className="text-sm text-muted-foreground">
            {t("exams.answered", { done: answered, total: items.length })}
          </span>
          <Button className="ml-auto" loading={finishing} onClick={askFinish}>
            {finishLabel}
          </Button>
        </footer>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("exams.handInTitle")}
        description={t("exams.handInUnanswered", { count: items.length - answered })}
        confirm={t("exams.handIn")}
        cancel={t("exams.goOn")}
        busy={finishing}
        onConfirm={() => {
          setConfirm(false);
          onFinish();
        }}
      />
    </div>
  );
}
