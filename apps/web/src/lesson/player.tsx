// Lesson player (09): overview → exercises one by one → summary; plan and reference at hand.

import { type ExerciseState, exerciseState, lessonCoverage } from "@sprachanker/engine";
import {
  type Lesson,
  type LessonResult,
  type LocaleLesson,
  parseEditionId,
  parseLessonKey,
} from "@sprachanker/schema";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, BookOpenText, Check, ListOrdered, Play, Star, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { mediaUrl } from "@/api/client.ts";
import { useCourseMap, useCourses, useLesson } from "@/api/hooks.ts";
import { useEdition } from "@/app/preferences.ts";
import { ExplainMistake } from "@/llm/explain.tsx";
import { SessionReview } from "@/llm/review.tsx";
import { SceneCard } from "@/llm/scene.tsx";
import { LessonTutor, ReviewMistakesButton, type TutorAsk } from "@/llm/tutor.tsx";
import { WritingTask } from "@/llm/writing.tsx";
import { ErrorState, Loading } from "@/ui/app-shell.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Progress } from "@/ui/components/progress.tsx";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/ui/components/sheet.tsx";
import { CourseHtml } from "@/ui/course-html.tsx";
import { AudioPlayer } from "@/ui/media.tsx";
import { TargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { ExerciseStep } from "./exercise-step.tsx";
import { Reference, type ReferenceTab, referenceTabs, VocabularyList } from "./reference.tsx";
import { type ExerciseResult, useRun } from "./use-run.ts";
import { EpisodeVideo } from "./video.tsx";

type Step = "overview" | number | "summary";

function StepDot({ state, label }: { state?: ExerciseState | "current"; label: React.ReactNode }) {
  return (
    <span
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-full border-2 text-xs font-semibold",
        state === "correct" && "border-correct bg-correct text-white",
        state === "wrong" && "border-wrong bg-wrong text-white",
        state === "done" && "border-muted-foreground bg-muted-foreground text-white",
        state === "current" && "border-primary",
      )}
    >
      {state === "correct" ? (
        <Check className="size-3.5" />
      ) : state === "wrong" ? (
        <X className="size-3.5" />
      ) : (
        label
      )}
    </span>
  );
}

function Plan({
  lesson,
  locale,
  step,
  results,
  go,
  openReference,
}: {
  lesson: Lesson;
  locale: LocaleLesson | null;
  step: Step;
  results: Record<string, ExerciseResult>;
  go(step: Step): void;
  openReference(tab: ReferenceTab): void;
}) {
  const { t } = useTranslation();
  const tabs = referenceTabs(lesson, locale);
  const row = (target: Step, dot: React.ReactNode, label: string) => (
    <button
      type="button"
      key={String(target)}
      onClick={() => go(target)}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left text-[15px] hover:bg-accent",
        step === target && "bg-accent font-semibold",
      )}
    >
      {dot}
      <span className="leading-snug">{label}</span>
    </button>
  );
  return (
    <nav className="space-y-0.5">
      {row("overview", <StepDot label={<Play className="size-3" />} />, t("lesson.overview"))}
      {lesson.pages.map(({ exercise }, i) =>
        row(
          i,
          <StepDot
            state={exerciseState(results[exercise.key]) ?? (step === i ? "current" : undefined)}
            label={i + 1}
          />,
          locale?.exercises[exercise.key]?.title ?? exercise.key,
        ),
      )}
      {row("summary", <StepDot label={<Star className="size-3" />} />, t("lesson.summary"))}
      {!!tabs.length && (
        <div className="mt-4 border-t pt-3">
          <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("lesson.reference")}
          </p>
          {tabs.map((tab) => (
            <button
              type="button"
              key={tab}
              onClick={() => openReference(tab)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[15px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <BookOpenText className="size-4" /> {t(`ref.${tab}`)}
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}

export function LessonPlayer({
  series,
  course,
  lesson: lessonId,
}: {
  series: string;
  course: string;
  lesson: string;
}) {
  const { t, i18n } = useTranslation();
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
  const [tutorAsk, setTutorAsk] = useState<TutorAsk>();
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
  // The score shown on the summary: of the run just finished, or of the latest finished run.
  const result = finished ?? (run.mode === "finished" ? run.run?.result : undefined);

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
  const coverage = lessonCoverage(lesson, run.results);
  // Items right at the first attempt in the run shown (the score itself also weighs partial answers).
  const firstCorrect = Object.values(run.results)
    .flatMap((r) => Object.values(r.first))
    .filter((o) => o.result === "correct").length;
  const done = coverage.worked;
  const numbers = parseLessonKey(lesson.key);
  const unitTitle = map.data?.locale?.units[lesson.unit]?.title;
  const firstTab = referenceTabs(lesson, locale)[0];

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

  return (
    <TargetLang value={parseEditionId(edition).target}>
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
            {total > 0 && t("lesson.exercisesDone", { done, total })}
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
              <LessonTutor
                ask={tutorAsk}
                series={series}
                lessonKey={lesson.key}
                edition={edition}
                exerciseKey={
                  typeof step === "number" ? lesson.pages[step]?.exercise.key : undefined
                }
              />
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
              <section className="space-y-5">
                <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                  {t("lesson.unitLesson", numbers)}
                  {unitTitle && ` · ${unitTitle}`}
                </p>
                <h1 className="text-4xl font-bold">{locale?.title ?? lesson.key}</h1>
                {locale?.synopsisHtml && (
                  <CourseHtml className="text-lg" html={locale.synopsisHtml} />
                )}
                {!!lesson.goals.length && (
                  <div className="rounded-2xl bg-accent px-5 py-4">
                    <p className="font-semibold">{t("lesson.goals")}</p>
                    <ul className="mt-1 list-disc pl-5">
                      {lesson.goals.map((g) => (
                        <li key={g}>{map.data?.locale?.goals[g]?.text}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {lesson.media.video ? (
                  <EpisodeVideo {...lesson.media.video} url={url} />
                ) : (
                  lesson.media.image && (
                    <img src={url(lesson.media.image)} alt="" className="w-full rounded-2xl" />
                  )
                )}
                {lesson.media.audio && (
                  <AudioPlayer
                    src={url(lesson.media.audio)}
                    label={locale?.title ?? lesson.key}
                    title={t("lesson.audio")}
                  />
                )}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <span className="text-muted-foreground">
                    {t("lesson.counts", { exercises: total, words: lesson.vocab.length })}
                  </span>
                  {run.mode === "finished" ? (
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
                  )}
                </div>
              </section>
            )}
            {typeof step === "number" && lesson.pages[step] && (
              <ExerciseStep
                key={`${run.run?.id}-${step}`}
                stored={run.results[lesson.pages[step].exercise.key]}
                readOnly={run.mode === "finished"}
                exercise={lesson.pages[step].exercise}
                locale={locale?.exercises[lesson.pages[step].exercise.key]}
                index={step}
                total={total}
                url={url}
                onAnswered={run.answer}
                onBack={() => go(step > 0 ? step - 1 : "overview")}
                onNext={() => go(step + 1 < total ? step + 1 : "summary")}
                explain={(index, answer) => (
                  <ExplainMistake
                    series={series}
                    lessonKey={lesson.key}
                    edition={edition}
                    exerciseKey={lesson.pages[step]?.exercise.key ?? ""}
                    index={index}
                    answer={answer}
                  />
                )}
              />
            )}
            {step === "summary" && (
              <section className="space-y-6">
                <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                  {t("lesson.summary")}
                </p>
                <h1 className="text-4xl font-bold">{locale?.title}</h1>
                {total > 0 && (
                  <div className="flex items-end gap-4">
                    <span className="font-heading text-6xl font-bold">
                      {result
                        ? new Intl.NumberFormat(i18n.language, { style: "percent" }).format(
                            result.score,
                          )
                        : "—"}
                    </span>
                    {result && (
                      <span className="pb-2 text-muted-foreground">
                        {t("lesson.score", {
                          correct: firstCorrect,
                          scored: result.scored,
                        })}
                      </span>
                    )}
                  </div>
                )}
                {active && !coverage.complete && coverage.firstLeft !== undefined && (
                  <div className="space-y-3 rounded-2xl bg-accent px-5 py-4">
                    <p>{t("lesson.left", { count: total - coverage.worked })}</p>
                    <Button
                      size="lg"
                      onClick={() => coverage.firstLeft !== undefined && go(coverage.firstLeft)}
                    >
                      {t("lesson.toExercise", { n: coverage.firstLeft + 1 })}
                    </Button>
                  </div>
                )}
                {run.mode === "finished" && (
                  <Button size="lg" onClick={() => void begin(true)}>
                    {t("lesson.redo")}
                  </Button>
                )}
                {Object.values(run.results).some((r) =>
                  Object.values(r.first).some(
                    (o) => o.result === "wrong" || o.result === "partial",
                  ),
                ) && <ReviewMistakesButton onAsk={setTutorAsk} />}
                <SessionReview series={series} lessonKey={lesson.key} edition={edition} />
                <WritingTask series={series} lessonKey={lesson.key} edition={edition} />
                <SceneCard series={series} lessonKey={lesson.key} edition={edition} />
                {total > 0 && (
                  <ul className="divide-y rounded-2xl border bg-card">
                    {lesson.pages.map(({ exercise }, i) => {
                      const r = run.results[exercise.key];
                      const s = exerciseState(r);
                      const outcomes = Object.values(r?.first ?? {}).filter(
                        (o) => o.result !== "unscored",
                      );
                      return (
                        <li key={exercise.key}>
                          <button
                            type="button"
                            onClick={() => go(i)}
                            className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent"
                          >
                            <StepDot state={s} label={i + 1} />
                            <span className="flex-1">{locale?.exercises[exercise.key]?.title}</span>
                            <span className="text-sm text-muted-foreground">
                              {!s
                                ? t("lesson.notDone")
                                : outcomes.length
                                  ? `${outcomes.filter((o) => o.result === "correct").length}/${outcomes.length}`
                                  : r && !Object.keys(r.last).length
                                    ? t("lesson.skipped")
                                    : ""}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div>
                  <h2 className="text-2xl font-bold">{t("lesson.newWords")}</h2>
                  <p className="mb-2 text-sm text-muted-foreground">{t("lesson.newWordsHint")}</p>
                  <VocabularyList lesson={lesson} locale={locale} url={url} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    to="/course/$series/$course"
                    params={{ series, course }}
                    className="inline-flex min-h-11 items-center rounded-xl border px-4 font-medium hover:bg-accent"
                  >
                    {t("lesson.backToCourse")}
                  </Link>
                  {nextLesson && (
                    <Link
                      to="/lesson/$series/$course/$lesson"
                      params={{ series, course, lesson: parseLessonKey(nextLesson).name }}
                      className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 font-semibold text-primary-foreground hover:bg-primary/90"
                    >
                      {t("lesson.nextLesson")} →
                    </Link>
                  )}
                </div>
              </section>
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
    </TargetLang>
  );
}
