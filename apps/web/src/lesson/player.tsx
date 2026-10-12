// Lesson player (09): the lesson's plan as steps — overview, words, grammar, exercises, culture, AI
// practice, summary. This file loads the lesson and its run and shows the step the flow is on
// (use-flow.ts) inside the player's frame (frame.tsx); the pages are overview, words-step, steps
// (reading), exercise-step, practice-step and summary; optional features come in as slots.
import { hasMistakesToGoOver } from "@sprachanker/engine";
import { lessonOrder, parseEditionId, parseLessonKey } from "@sprachanker/schema";
import { useTranslation } from "react-i18next";
import { mediaUrl } from "@/api/client.ts";
import { useCourseMap, useLesson } from "@/api/courses.ts";
import { useCourseEdition } from "@/api/edition.ts";
import { ShuffleSeed } from "@/exercises/shared.tsx";
import { CourseGone } from "@/library/course-gone.tsx";
import { CourseMedia } from "@/ui/course-html.tsx";
import { ErrorState, Loading } from "@/ui/page.tsx";
import { TargetLang } from "@/ui/target-lang.ts";
import { Episode } from "@/ui/video.tsx";
import { useWindowPlace } from "@/ui/window-title.ts";
import { ExerciseStep } from "./exercise-step.tsx";
import { PlayerFrame } from "./frame.tsx";
import { LessonOverview, ResetLesson, WayIn } from "./overview.tsx";
import { Plan } from "./plan.tsx";
import { PracticeStep } from "./practice-step.tsx";
import type { LessonSlots } from "./slots.ts";
import { ReadingStep, StepBar } from "./steps.tsx";
import { LessonSummary } from "./summary.tsx";
import { useLessonFlow } from "./use-flow.ts";
import { useRun } from "./use-run.ts";
import { WordsStep } from "./words-step.tsx";

export function LessonPlayer({
  series,
  course,
  lesson: lessonId,
  step: opened,
  onStep,
  slots = {},
}: {
  series: string;
  course: string;
  lesson: string;
  /** The step in the page's address. */
  step?: string;
  onStep?(id: string): void;
  slots?: LessonSlots;
}) {
  const { t } = useTranslation();
  const key = `${series}/${course}/${lessonId}`;
  const { courses, info, edition } = useCourseEdition(series, course);
  const data = useLesson(series, key, edition);
  const map = useCourseMap(series, course, edition);
  const run = useRun(series, key, edition);
  const practice = slots.practice?.useKinds();
  const explains = slots.explain?.useOn() ?? false;
  const flow = useLessonFlow({
    lesson: data.data?.lesson,
    locale: data.data?.locale,
    // The AI practice offered (none while no assistant is set up); `slots` is fixed for the player.
    practice: slots.practice ? practice : [],
    run,
    opened,
    onShow: onStep,
  });
  const url = (p: string) => mediaUrl(series, p);
  const step = flow.step;
  const lessonData = data.data?.lesson;
  useWindowPlace(
    !lessonData || !step
      ? undefined
      : step.kind === "exercise"
        ? t("windowTitle.exercise", { n: step.index + 1, total: lessonData.pages.length })
        : step.kind === "overview"
          ? t("windowTitle.lesson", parseLessonKey(lessonData.key))
          : t(`windowTitle.${step.kind}`),
  );

  if (courses.isSuccess && !info) return <CourseGone series={series} course={course} />;
  if (run.error) return <ErrorState error={run.error} onRetry={run.retry} />;
  if (
    data.isPending ||
    !edition ||
    run.mode === "loading" ||
    (slots.practice && !practice) ||
    !step
  )
    return <Loading />;
  if (data.isError) return <ErrorState error={data.error} onRetry={() => data.refetch()} />;
  const { lesson, locale } = data.data;
  const context = { series, lessonKey: lesson.key, edition };
  const { go, next, back, mark, result } = flow;
  const allLessons = map.data ? lessonOrder(map.data.index) : [];
  const nextLesson = allLessons[allLessons.indexOf(lesson.key) + 1];
  const exercise = step.kind === "exercise" ? lesson.pages[step.index]?.exercise : undefined;
  // The episode with its text: an exercise showing it plays it, and then the overview does not.
  const episode = lesson.media.video && {
    ...lesson.media.video,
    textHtml: locale?.tabs.script?.bodyHtml,
  };

  return (
    <TargetLang value={parseEditionId(edition).target}>
      <CourseMedia.Provider value={url}>
        <Episode.Provider value={episode}>
          <PlayerFrame
            series={series}
            course={course}
            courseTitle={map.data?.locale?.title ?? course}
            lesson={lesson}
            locale={locale}
            worked={flow.worked}
            reached={flow.reached}
            todo={flow.todo}
            plan={(chosen) => (
              <Plan
                lesson={lesson}
                locale={locale}
                steps={flow.steps}
                current={flow.current}
                results={run.results}
                done={run.done}
                practice={run.practice}
                go={(id) => {
                  chosen?.();
                  go(id);
                }}
              />
            )}
            header={slots.header?.({ ...context, exerciseKey: exercise?.key })}
            url={url}
          >
            {flow.error !== undefined && <ErrorState error={flow.error} />}
            {step.kind === "overview" && (
              <LessonOverview
                lesson={lesson}
                locale={locale}
                unitTitle={map.data?.locale?.units[lesson.unit]?.title}
                goals={map.data?.locale?.goals ?? {}}
                url={url}
                actions={<WayIn flow={flow} mode={run.mode} />}
                more={
                  run.mode !== "none" && (
                    <ResetLesson
                      series={series}
                      course={course}
                      lesson={lesson.key}
                      title={locale?.title ?? lesson.key}
                      onDone={() => {
                        flow.forget();
                        run.reload();
                      }}
                    />
                  )
                }
              />
            )}
            {step.kind === "words" && (
              <WordsStep
                series={series}
                edition={edition}
                lesson={lesson}
                locale={locale}
                onDone={() => mark("words")}
                // A step done stays done: no Skip over it.
                onSkip={
                  run.done.get("words") === "done"
                    ? undefined
                    : () => {
                        mark("words", true);
                        next();
                      }
                }
                onBack={back}
                onNext={next}
              />
            )}
            {(step.kind === "grammar" || step.kind === "culture") && (
              <ReadingStep
                section={t(`lesson.step.${step.kind}`)}
                page={locale?.tabs[step.kind][step.index] ?? { bodyHtml: "" }}
              >
                <StepBar onBack={back} onNext={next} />
              </ReadingStep>
            )}
            {step.kind === "exercise" && exercise && (
              // Options ordered anew for every pass of the lesson.
              <ShuffleSeed.Provider value={run.run?.id ?? ""}>
                <ExerciseStep
                  key={`${run.run?.id}-${step.index}`}
                  stored={run.results[exercise.key]}
                  readOnly={run.mode === "finished"}
                  exercise={exercise}
                  locale={locale?.exercises[exercise.key]}
                  index={step.index}
                  total={lesson.pages.length}
                  last={flow.ids[flow.at + 1] === "summary"}
                  url={url}
                  onAnswered={run.answer}
                  onBack={back}
                  onNext={next}
                  explain={
                    explains
                      ? (index, answer) =>
                          slots.explain?.view({
                            ...context,
                            exerciseKey: exercise.key,
                            index,
                            answer,
                            // Kept with the run and the attempt it explains (the latest answer).
                            runId: run.run?.id,
                            attempt: run.attempts(exercise.items[index]?.key ?? "") || undefined,
                            stored: run.flush,
                          })
                      : undefined
                  }
                  spoken={
                    slots.spoken && run.run
                      ? (index, transcript) =>
                          slots.spoken?.({
                            ...context,
                            exerciseKey: exercise.key,
                            index,
                            transcript,
                            runId: run.run?.id as string,
                            onStored: (event) => run.received([event]),
                          })
                      : undefined
                  }
                />
              </ShuffleSeed.Provider>
            )}
            {(step.kind === "reading" ||
              step.kind === "listening" ||
              step.kind === "writing" ||
              step.kind === "speaking") && (
              <PracticeStep
                kind={step.kind}
                lesson={lesson}
                locale={locale}
                run={run}
                slots={slots}
                context={context}
                mark={mark}
                onBack={back}
                onNext={next}
              />
            )}
            {step.kind === "summary" && (
              <LessonSummary
                series={series}
                course={course}
                lesson={lesson}
                locale={locale}
                steps={flow.steps}
                results={run.results}
                done={run.done}
                practice={run.practice}
                mistakes={
                  slots.mistakes &&
                  hasMistakesToGoOver(run.events, lesson, locale, parseEditionId(edition).target) &&
                  slots.mistakes({ ...context, runId: run.run?.id })
                }
                result={result}
                mode={run.mode}
                nextLesson={nextLesson}
                go={go}
                redo={() => void flow.begin(true)}
              />
            )}
          </PlayerFrame>
        </Episode.Provider>
      </CourseMedia.Provider>
    </TargetLang>
  );
}
