// An exam run handed in (09, Exams; owner's choice 4B, 2026-10-10): the points and each pass mark
// reached or not, the points by section, then the questions answered wrongly or not at all with the
// right answer (all of them on request), and the ways on: practise the mistakes, try again, back.
import type {
  Exam,
  ExamItem,
  ExamMode,
  ExamRun,
  LocaleExam,
  TypedEvent,
} from "@sprachanker/schema";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Check, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { mediaUrl } from "@/api/client.ts";
import { useStartExam } from "@/api/exams.ts";
import { ItemCard } from "@/exercises/item-card.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Progress } from "@/ui/components/progress.tsx";
import { errorText } from "@/ui/error-text.ts";
import { useDateFormat } from "@/ui/format.ts";
import { ProgressRing } from "@/ui/progress-ring.tsx";
import { cn } from "@/ui/utils.ts";
import type { ExamParams } from "./params.ts";
import { asExercise, latestAnswers } from "./questions.ts";

export function ExamResultView({
  title,
  params,
  run,
  exam,
  locale,
  items,
  events,
  onLeave,
}: {
  title: string;
  params: ExamParams;
  run: ExamRun;
  exam: Exam;
  locale: LocaleExam | null;
  items: ExamItem[];
  events: TypedEvent[];
  onLeave(): void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const begin = useStartExam();
  const date = useDateFormat("dayTime");
  const [all, setAll] = useState(false);
  const answers = useMemo(() => latestAnswers(events), [events]);
  const exercise = useMemo(() => asExercise(title, items), [title, items]);
  const result = run.result;
  const practice = run.plan.mode === "practice";
  // Practice is scored over the questions answered; a mock exam over all it asked.
  const asked = practice ? items.filter((i) => answers.has(i.key)) : items;
  const wrong = asked.filter((i) => answers.get(i.key)?.outcome?.result !== "correct");
  const shown = all ? asked : wrong;
  const passed = !!result?.passed.length;
  const again = (mode: ExamMode) =>
    run.edition &&
    begin.mutate(
      { exam: run.exam, edition: run.edition, mode },
      {
        onSuccess: ({ run: next }) =>
          void navigate({
            to: "/exam/$series/$course/$exam/run/$run",
            params: { ...params, run: next.id },
          }),
      },
    );

  return (
    <div className="mx-auto max-w-3xl px-4 pt-6 pb-16 sm:px-6">
      <button
        type="button"
        onClick={onLeave}
        className="mb-4 flex min-h-9 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> {title}
      </button>
      <p className="text-sm text-muted-foreground">
        {t(practice ? "exams.mode.practice" : "exams.mode.test")} ·{" "}
        {date.format(run.finishedAt ?? run.startedAt)}
      </p>
      {result && (
        <section className="mt-3 rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-4">
            <ProgressRing
              value={result.max ? result.points / result.max : 0}
              text={`${result.points}/${result.max}`}
              tone={practice ? "primary" : passed ? "correct" : "wrong"}
            />
            <div>
              {practice ? (
                <h1 className="font-heading text-2xl font-bold">
                  {t("exams.practiceScore", { points: result.points, count: result.max })}
                </h1>
              ) : (
                <h1
                  className={cn(
                    "font-heading text-3xl font-bold",
                    passed ? "text-correct" : "text-wrong",
                  )}
                >
                  {t(passed ? "exams.passed" : "exams.failed")}
                </h1>
              )}
              {run.endReason === "timeout" && (
                <p className="text-sm text-muted-foreground">{t("exams.timeUp")}</p>
              )}
            </div>
          </div>
          {!practice && (
            <ul className="mt-4 space-y-1.5">
              {exam.thresholds.map((th) => {
                const ok = result.passed.includes(th.id);
                return (
                  <li key={th.id} className="flex items-center gap-2 text-sm">
                    {ok ? (
                      <Check className="size-4 text-correct" aria-hidden />
                    ) : (
                      <X className="size-4 text-wrong" aria-hidden />
                    )}
                    <span className="flex-1">{locale?.thresholds[th.id]?.title ?? th.id}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {t("exams.needed", { points: th.minPoints, max: result.max })}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {!practice && Object.keys(result.sections).length > 1 && (
            <div className="mt-4 space-y-3">
              {Object.entries(result.sections).map(([key, s]) => (
                <div key={key}>
                  <div className="flex justify-between text-sm">
                    <span>{locale?.sections[key as keyof typeof locale.sections]?.title}</span>
                    <span className="tabular-nums">
                      {s.points}/{s.max}
                    </span>
                  </div>
                  <Progress value={s.max ? (s.points / s.max) * 100 : 0} className="mt-1 h-2" />
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {wrong.length > 0 && (
          <Button onClick={() => again("practice")} loading={begin.isPending}>
            {t("exams.practiseMistakes")}
          </Button>
        )}
        <Button variant="outline" onClick={() => again("test")} disabled={begin.isPending}>
          {t("exams.tryAgain")}
        </Button>
        <Button variant="ghost" onClick={onLeave}>
          {t("exams.toExam")}
        </Button>
      </div>
      {begin.isError && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {errorText(t, begin.error)}
        </p>
      )}

      <div className="mt-8 mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-heading text-xl font-bold">
          {all ? t("exams.allAnswers") : t("exams.mistakes", { count: wrong.length })}
        </h2>
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="text-sm font-medium underline"
        >
          {all ? t("exams.onlyMistakes") : t("exams.showAll")}
        </button>
      </div>
      {shown.length ? (
        <ol className="space-y-6">
          {shown.map((item) => {
            const index = items.indexOf(item);
            const given = answers.get(item.key);
            return (
              <li key={item.key}>
                <p className="mb-1.5 text-sm text-muted-foreground">
                  {t("exams.question", { n: index + 1, total: items.length })}
                  {!given && ` · ${t("exams.notAnswered")}`}
                </p>
                <ItemCard
                  exercise={exercise}
                  locale={null}
                  index={index}
                  answer={given?.answer}
                  outcome={
                    given?.outcome ?? { result: "wrong", score: 0, ruleIds: [], lexemes: [] }
                  }
                  url={(path) => mediaUrl(params.series, path)}
                />
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="rounded-2xl border border-dashed p-6 text-center text-muted-foreground">
          {t("exams.noMistakes")}
        </p>
      )}
    </div>
  );
}
