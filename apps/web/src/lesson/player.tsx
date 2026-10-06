// Lesson player (09): overview → exercises one by one → summary; plan and reference at hand. This file
// holds the run's flow (resume, start, record pages, complete); the pages are overview, exercise-step
// and summary, the plan is plan.tsx; optional features come in as slots.
import { exerciseState, lessonCoverage } from "@sprachanker/engine";
import {
  type Lesson,
  type LessonResult,
  type LocaleLesson,
  parseEditionId,
} from "@sprachanker/schema";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, BookOpenText, ListOrdered, RotateCcw } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { mediaUrl } from "@/api/client.ts";
import { useCourseMap, useCourses, useLesson } from "@/api/hooks.ts";
import { useEdition } from "@/app/preferences.ts";
import { ErrorState, Loading } from "@/ui/app-shell.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Progress } from "@/ui/components/progress.tsx";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/ui/components/sheet.tsx";
import { CourseMedia } from "@/ui/course-html.tsx";
import { ResetProgress } from "@/ui/reset-progress.tsx";
import { TargetLang } from "@/ui/target-lang.ts";
import { ExerciseStep } from "./exercise-step.tsx";
import { LessonOverview } from "./overview.tsx";
import { Plan, type Step } from "./plan.tsx";
import { Reference, type ReferenceTab, referenceTabs } from "./reference.tsx";
import type { LessonSlots } from "./slots.ts";
import { LessonSummary } from "./summary.tsx";
import { useRun } from "./use-run.ts";

export function LessonPlayer({
  series,
  course,
  lesson: lessonId,
  slots = {},
}: {
  series: string;
  course: string;
  lesson: string;
  slots?: LessonSlots;
}) {
  const { t } = useTranslation();
  const key = `${series}/${course}/${lessonId}`;
  const courses = useCourses();
  const info = courses.data?.find((c) => c.series === series && c.course === course);
  const edition = useEdition(series, course, info?.editions);
  const data = useLesson(series, key, edition);
  const map = useCourseMap(series, course, edition);
  const run = useRun(series, key, edition);
  const [step, setStep] = useState<Step>("overview");
  const [reference, setReference] = useState<ReferenceTab>();
  const [planOpen, setPlanOpen] = useState(false);
  const [finished, setFinished] = useState<LessonResult | null>();
  const url = (p: string) => mediaUrl(series, p);

  // Resume an active run on the page it was left on, if the lesson still has it.
  const pages = data.data?.lesson.pages.length;
  const active = run.mode === "active";
  useEffect(() => {
    const page = run.resumePage;
    if (active && pages !== undefined && page >= 0 && page < pages) setStep(page);
  }, [active, run.resumePage, pages]);

  // Reaching the summary with every exercise worked completes an active run (05, "Lifecycle").
  const { finish } = run;
  const lessonData = data.data?.lesson;
  const complete = !!lessonData && lessonCoverage(lessonData, run.results).complete;
  useEffect(() => {
    if (step === "summary" && active && complete)
      finish()
        .then(setFinished)
        .catch(() => undefined);
  }, [step, active, complete, finish]);

  if (data.isPending || !edition || run.mode === "loading")
    return run.error ? <ErrorState error={run.error} /> : <Loading />;
  if (data.isError) return <ErrorState error={data.error} onRetry={() => data.refetch()} />;
  const { lesson, locale } = data.data as { lesson: Lesson; locale: LocaleLesson | null };
  const total = lesson.pages.length;
  const resume = active && run.resumePage < total ? run.resumePage : -1;
  // The score shown: of the run just finished, or of the latest finished run.
  const result = finished ?? (run.mode === "finished" ? run.run?.result : undefined);
  const context = { series, lessonKey: lesson.key, edition };

  const show = (next: Step) => {
    setPlanOpen(false);
    setStep(next);
    window.scrollTo({ top: 0 });
  };
  /** Moves to a step. In an active run pages are recorded; opening a page of a lesson never started
   *  starts it; a finished run is only looked at. */
  const go = (next: Step) => {
    show(next);
    if (typeof next !== "number") return;
    if (active) run.pageShown(next);
    else if (run.mode === "none") void run.start().then(() => run.pageShown(next));
  };
  /** Starts the lesson (anew when `restart`) and opens its first page. */
  const begin = async (restart: boolean) => {
    await run.start(restart);
    setFinished(undefined);
    show(0);
    run.pageShown(0);
  };

  const allLessons = map.data?.index.units.flatMap((u) => u.lessons) ?? [];
  const nextLesson = allLessons[allLessons.indexOf(lesson.key as never) + 1];
  const done = lessonCoverage(lesson, run.results).worked;
  const skipped = lesson.pages.filter(
    ({ exercise }) => exerciseState(exercise, run.results[exercise.key]) === "skipped",
  ).length;
  // Answers that were wrong or partly right at the first attempt (skips are not mistakes to talk over).
  const hasMistakes = Object.values(run.results).some((r) =>
    Object.values(r.first).some((o) => o.result === "wrong" || o.result === "partial"),
  );
  const firstTab = referenceTabs(lesson, locale)[0];
  const exercise = typeof step === "number" ? lesson.pages[step]?.exercise : undefined;

  const plan = (
    <Plan
      lesson={lesson}
      locale={locale}
      step={step}
      results={run.results}
      go={go}
      openReference={(tab) => setReference(tab)}
    />
  );

  const actions =
    run.mode === "finished" ? (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          {result && result.scored > 0
            ? t("lesson.doneScore", { score: result.score })
            : t("lesson.done")}
        </span>
        <Button size="lg" variant="outline" onClick={() => show("summary")}>
          {t("lesson.summary")}
        </Button>
        <Button size="lg" className="text-base" onClick={() => void begin(true)}>
          {t("lesson.redo")}
        </Button>
      </div>
    ) : (
      <Button
        size="lg"
        className="text-base"
        onClick={() =>
          total === 0
            ? void run.start().then(() => show("summary"))
            : active
              ? go(resume > 0 ? resume : 0)
              : void begin(false)
        }
      >
        {resume > 0 ? t("lesson.resume") : t("lesson.start")}
      </Button>
    );

  const frame = slots.frame ?? ((children: React.ReactNode) => <Fragment>{children}</Fragment>);
  return frame(
    <TargetLang value={parseEditionId(edition).target}>
      <CourseMedia.Provider value={url}>
        <div className="lg:grid lg:grid-cols-[17rem_1fr]">
          <aside className="sticky top-0 hidden h-dvh overflow-y-auto border-r p-4 lg:block">
            <Link
              to="/course/$series/$course"
              params={{ series, course }}
              className="mb-3 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" /> {map.data?.locale?.title ?? course}
            </Link>
            <h2 className="mb-1 px-2 text-xl font-bold">{locale?.title}</h2>
            <p className="mb-3 px-2 text-sm text-muted-foreground">
              {total > 0 && t("lesson.exercisesDone", { done: done - skipped, total, skipped })}
            </p>
            {plan}
          </aside>
          <div className="min-w-0">
            <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
              <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  aria-label={t("lesson.plan")}
                  onClick={() => setPlanOpen(true)}
                >
                  <ListOrdered className="size-5" />
                </Button>
                {total > 0 ? (
                  <>
                    <Progress value={(done / total) * 100} className="h-2 flex-1" />
                    <span className="w-14 text-right text-sm tabular-nums text-muted-foreground">
                      {done}/{total}
                    </span>
                  </>
                ) : (
                  <span className="flex-1" />
                )}
                {slots.header?.({ ...context, exerciseKey: exercise?.key })}
                {firstTab && (
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={t("lesson.reference")}
                    onClick={() => setReference(firstTab)}
                  >
                    <BookOpenText className="size-4" />{" "}
                    <span className="hidden sm:inline">{t("lesson.reference")}</span>
                  </Button>
                )}
              </div>
            </header>
            <div className="mx-auto max-w-3xl px-4 py-6">
              {step === "overview" && (
                <LessonOverview
                  lesson={lesson}
                  locale={locale}
                  unitTitle={map.data?.locale?.units[lesson.unit]?.title}
                  goals={map.data?.locale?.goals ?? {}}
                  url={url}
                  actions={actions}
                  more={
                    run.mode !== "none" && (
                      <ResetProgress
                        series={series}
                        course={course}
                        lesson={lesson.key}
                        title={locale?.title ?? lesson.key}
                        onDone={() => {
                          setFinished(undefined);
                          run.reload();
                        }}
                      >
                        {(open) => (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={open}
                            className="text-muted-foreground"
                          >
                            <RotateCcw className="size-4" /> {t("progress.resetLesson")}
                          </Button>
                        )}
                      </ResetProgress>
                    )
                  }
                />
              )}
              {typeof step === "number" && exercise && (
                <ExerciseStep
                  key={`${run.run?.id}-${step}`}
                  stored={run.results[exercise.key]}
                  readOnly={run.mode === "finished"}
                  exercise={exercise}
                  locale={locale?.exercises[exercise.key]}
                  index={step}
                  total={total}
                  url={url}
                  onAnswered={run.answer}
                  onBack={() => go(step > 0 ? step - 1 : "overview")}
                  onNext={() => go(step + 1 < total ? step + 1 : "summary")}
                  explain={
                    slots.explain &&
                    ((index, answer) =>
                      slots.explain?.({ ...context, exerciseKey: exercise.key, index, answer }))
                  }
                />
              )}
              {step === "summary" && (
                <LessonSummary
                  series={series}
                  course={course}
                  lesson={lesson}
                  locale={locale}
                  url={url}
                  results={run.results}
                  result={result}
                  mode={run.mode}
                  nextLesson={nextLesson}
                  extra={slots.summary?.({ ...context, hasMistakes })}
                  go={go}
                  redo={() => void begin(true)}
                />
              )}
            </div>
          </div>
          <Sheet open={planOpen} onOpenChange={setPlanOpen}>
            <SheetContent side="left" className="w-80 overflow-y-auto p-4">
              <SheetHeader className="p-0">
                <SheetTitle>{locale?.title}</SheetTitle>
              </SheetHeader>
              {plan}
            </SheetContent>
          </Sheet>
          <Sheet open={!!reference} onOpenChange={(open) => !open && setReference(undefined)}>
            <SheetContent side="right" className="w-full overflow-y-auto p-5 sm:max-w-xl">
              <SheetHeader className="p-0">
                <SheetTitle>{t("lesson.reference")}</SheetTitle>
              </SheetHeader>
              {reference && (
                <Reference
                  lesson={lesson}
                  locale={locale}
                  url={url}
                  tab={reference}
                  onTab={setReference}
                />
              )}
            </SheetContent>
          </Sheet>
        </div>
      </CourseMedia.Provider>
    </TargetLang>,
  );
}
