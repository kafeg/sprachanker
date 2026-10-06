// Lesson player (09): the lesson's plan as steps — overview, words, grammar, exercises, culture, AI
// practice, summary — with the plan and reference at hand. This file holds the run's flow (resume,
// start, record steps, complete); the pages are overview, words-step, steps (reading), exercise-step and
// summary, the plan is plan.tsx; optional features come in as slots.
import { type LessonStep, lessonSteps, planCoverage, stepId } from "@sprachanker/engine";
import {
  type Lesson,
  type LessonResult,
  type LocaleLesson,
  parseEditionId,
  parseLessonKey,
  type StepId,
} from "@sprachanker/schema";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, BookOpenText, ListOrdered, RotateCcw } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { mediaUrl } from "@/api/client.ts";
import { useCourseMap, useCourses, useLesson, useMakeCards } from "@/api/hooks.ts";
import { useEdition } from "@/app/preferences.ts";
import { ErrorState, Loading } from "@/ui/app-shell.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Progress } from "@/ui/components/progress.tsx";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/ui/components/sheet.tsx";
import { CourseMedia } from "@/ui/course-html.tsx";
import { ResetProgress } from "@/ui/reset-progress.tsx";
import { TargetLang } from "@/ui/target-lang.ts";
import { useWindowPlace } from "@/ui/window-title.ts";
import { ExerciseStep } from "./exercise-step.tsx";
import { LessonOverview } from "./overview.tsx";
import { Plan, stepTitle } from "./plan.tsx";
import { Reference, type ReferenceTab, referenceTabs } from "./reference.tsx";
import type { LessonSlots } from "./slots.ts";
import { ReadingStep, StepBar } from "./steps.tsx";
import { LessonSummary } from "./summary.tsx";
import { useRun } from "./use-run.ts";
import { WordsStep } from "./words-step.tsx";

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
  const makeCards = useMakeCards();
  const [current, setCurrent] = useState("overview");
  const [reference, setReference] = useState<ReferenceTab>();
  const [planOpen, setPlanOpen] = useState(false);
  const [finished, setFinished] = useState<LessonResult | null>();
  const url = (p: string) => mediaUrl(series, p);
  // The AI practice offered (none while no assistant is set up); `slots` is fixed for the player.
  const practice = slots.practice?.useKinds() ?? [];

  const lessonData = data.data?.lesson as Lesson | undefined;
  const localeData = data.data?.locale as LocaleLesson | null | undefined;
  const steps = lessonData ? lessonSteps(lessonData, localeData, practice) : [];
  const ids = steps.map(stepId);
  const coverage = lessonData ? planCoverage(steps, lessonData, run.results, run.done) : undefined;

  // Resume an active run where it was left: the exercise last shown if it is not done, else the first
  // step still to do.
  const active = run.mode === "active";
  const pages = lessonData?.pages.length;
  const firstLeft = coverage?.firstLeft;
  const resumeId =
    active && pages !== undefined && run.resumePage >= 0 && run.resumePage < pages
      ? (() => {
          const page = `exercise:${run.resumePage}`;
          const exercise = lessonData?.pages[run.resumePage]?.exercise;
          const worked = exercise && run.results[exercise.key];
          return worked && firstLeft !== undefined ? (ids[firstLeft] ?? page) : page;
        })()
      : undefined;
  // Once per run loaded (not while the learner works through it).
  const runLoaded = active ? run.run?.id : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: resumeId is read when a run loads only
  useEffect(() => {
    if (resumeId) setCurrent(resumeId);
  }, [runLoaded, pages]);

  // Reaching the summary with every step done or skipped completes an active run (05, "Lifecycle").
  const { finish } = run;
  const complete = !!coverage?.complete;
  useEffect(() => {
    if (current === "summary" && active && complete)
      finish()
        .then(setFinished)
        .catch(() => undefined);
  }, [current, active, complete, finish]);

  const shownStep = steps[ids.indexOf(current)];
  useWindowPlace(
    !lessonData || !shownStep
      ? undefined
      : shownStep.kind === "exercise"
        ? t("windowTitle.exercise", { n: shownStep.index + 1, total: lessonData.pages.length })
        : shownStep.kind === "overview"
          ? t("windowTitle.lesson", parseLessonKey(lessonData.key))
          : t(`windowTitle.${shownStep.kind}`),
  );

  if (data.isPending || !edition || run.mode === "loading")
    return run.error ? <ErrorState error={run.error} /> : <Loading />;
  if (data.isError) return <ErrorState error={data.error} onRetry={() => data.refetch()} />;
  const { lesson, locale } = data.data as { lesson: Lesson; locale: LocaleLesson | null };
  const total = lesson.pages.length;
  const at = Math.max(0, ids.indexOf(current));
  const step = steps[at] as LessonStep;
  // The score shown: of the run just finished, or of the latest finished run.
  const result = finished ?? (run.mode === "finished" ? run.run?.result : undefined);
  const context = { series, lessonKey: lesson.key, edition };

  const show = (id: string) => {
    setPlanOpen(false);
    setCurrent(id);
    window.scrollTo({ top: 0 });
  };
  /** What opening a step records: an exercise page shown, a grammar or culture page read. */
  const record = (target: LessonStep) => {
    if (target.kind === "exercise") run.pageShown(target.index);
    if ((target.kind === "grammar" || target.kind === "culture") && !run.done.has(stepId(target)))
      run.stepDone(stepId(target) as StepId);
  };
  /** Moves to a step. In an active run it is recorded; opening a step of a lesson never started
   *  starts it; a finished run is only looked at. */
  const go = (id: string) => {
    show(id);
    const target = steps[ids.indexOf(id)];
    if (!target || target.kind === "overview" || target.kind === "summary") return;
    if (active) record(target);
    else if (run.mode === "none") void run.start().then(() => record(target));
  };
  const next = () => go(ids[at + 1] ?? "summary");
  const back = () => go(ids[at - 1] ?? "overview");
  /** Records a step besides the exercises as done or skipped (in an active run). */
  const mark = (id: string, skipped = false) => {
    if (active && run.done.get(id as StepId) !== (skipped ? "skipped" : "done"))
      run.stepDone(id as StepId, skipped);
  };
  /** Starts the lesson (anew when `restart`) and opens its first step after the overview. */
  const begin = async (restart: boolean) => {
    await run.start(restart);
    setFinished(undefined);
    const first = steps[1];
    if (!first) return;
    show(stepId(first));
    record(first);
  };

  const allLessons = map.data?.index.units.flatMap((u) => u.lessons) ?? [];
  const nextLesson = allLessons[allLessons.indexOf(lesson.key as never) + 1];
  const worked = coverage?.worked ?? 0;
  const todo = coverage?.total ?? 0;
  // Answers that were wrong or partly right at the first attempt (skips are not mistakes to talk over).
  const hasMistakes = Object.values(run.results).some((r) =>
    Object.values(r.first).some((o) => o.result === "wrong" || o.result === "partial"),
  );
  const firstTab = referenceTabs(lesson, locale)[0];
  const exercise = step.kind === "exercise" ? lesson.pages[step.index]?.exercise : undefined;

  const plan = (
    <Plan
      lesson={lesson}
      locale={locale}
      steps={steps}
      current={current}
      results={run.results}
      done={run.done}
      go={go}
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
        onClick={() => (active ? go(resumeId ?? ids[1] ?? "summary") : void begin(false))}
      >
        {active && worked > 0 ? t("lesson.resume") : t("lesson.start")}
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
              {todo > 0 && t("lesson.stepsDone", { done: worked, total: todo })}
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
                {todo > 0 ? (
                  <>
                    <Progress value={(worked / todo) * 100} className="h-2 flex-1" />
                    <span className="w-14 text-right text-sm tabular-nums text-muted-foreground">
                      {worked}/{todo}
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
              {step.kind === "overview" && (
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
              {step.kind === "words" && (
                <WordsStep
                  key={run.run?.id}
                  series={series}
                  lesson={lesson}
                  locale={locale}
                  url={url}
                  done={run.done.get("words") === "done"}
                  saving={makeCards.isPending}
                  onDone={(known) =>
                    makeCards.mutate(
                      { ...context, known },
                      {
                        onSuccess: () => {
                          mark("words");
                          next();
                        },
                      },
                    )
                  }
                  onSkip={() => {
                    mark("words", true);
                    next();
                  }}
                  onBack={back}
                />
              )}
              {(step.kind === "grammar" || step.kind === "culture") && (
                <ReadingStep
                  section={t(`lesson.step.${step.kind}`)}
                  page={locale?.tabs[step.kind][step.index] ?? { title: "", bodyHtml: "" }}
                >
                  <StepBar onBack={back} onNext={next} />
                </ReadingStep>
              )}
              {step.kind === "exercise" && exercise && (
                <ExerciseStep
                  key={`${run.run?.id}-${step.index}`}
                  stored={run.results[exercise.key]}
                  readOnly={run.mode === "finished"}
                  exercise={exercise}
                  locale={locale?.exercises[exercise.key]}
                  index={step.index}
                  total={total}
                  last={ids[at + 1] === "summary"}
                  url={url}
                  onAnswered={run.answer}
                  onBack={back}
                  onNext={next}
                  explain={
                    slots.explain &&
                    ((index, answer) =>
                      slots.explain?.({
                        ...context,
                        exerciseKey: exercise.key,
                        index,
                        answer,
                        // Kept with the run and the attempt it explains (the latest answer).
                        runId: run.run?.id,
                        attempt: run.attempts(exercise.items[index]?.key ?? "") || undefined,
                      }))
                  }
                />
              )}
              {(step.kind === "writing" || step.kind === "scene" || step.kind === "review") && (
                <article className="flex min-h-[calc(100dvh-8rem)] flex-col gap-4">
                  <div>
                    <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                      {t("lesson.section.practice")}
                    </p>
                    <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
                      {stepTitle(step, lesson, locale, t)}
                    </h1>
                  </div>
                  {slots.practice?.step(step.kind, {
                    ...context,
                    hasMistakes,
                    onDone: () => mark(step.kind),
                  })}
                  <StepBar
                    onBack={back}
                    onNext={next}
                    onSkip={
                      run.done.get(step.kind) === "done"
                        ? undefined
                        : () => {
                            mark(step.kind, true);
                            next();
                          }
                    }
                  />
                </article>
              )}
              {step.kind === "summary" && (
                <LessonSummary
                  series={series}
                  course={course}
                  lesson={lesson}
                  locale={locale}
                  steps={steps}
                  results={run.results}
                  done={run.done}
                  result={result}
                  mode={run.mode}
                  nextLesson={nextLesson}
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
