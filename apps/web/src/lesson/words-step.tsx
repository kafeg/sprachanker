// "Words of the lesson" (09): the lesson's words studied as in Anki — the same session as Review
// (study/session.tsx), over the first card of each word, without the day's new limit. Opening the step
// makes the cards (a word met before keeps its card); once nothing is left to study now, the step is
// done and the words go on in Review.
import type { Lesson, LocaleLesson } from "@sprachanker/schema";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useMakeCards } from "@/api/hooks.ts";
import { StudySession } from "@/study/session.tsx";
import { ErrorState, Loading } from "@/ui/app-shell.tsx";
import { StepBar } from "./steps.tsx";

export function WordsStep({
  series,
  edition,
  lesson,
  locale,
  onDone,
  onSkip,
  onBack,
  onNext,
}: {
  series: string;
  edition: string;
  lesson: Lesson;
  locale: LocaleLesson | null;
  /** Nothing left to study now: the step is done. */
  onDone(): void;
  /** Leaves the step undone. */
  onSkip(): void;
  onBack(): void;
  onNext(): void;
}) {
  const { t } = useTranslation();
  const make = useMakeCards();
  // biome-ignore lint/correctness/useExhaustiveDependencies: made once per lesson shown
  useEffect(() => {
    make.mutate({ series, lessonKey: lesson.key, edition });
  }, [lesson.key]);

  return (
    <article className="flex min-h-[calc(100dvh-8rem)] flex-col gap-4">
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {t("lesson.step.words")}
        </p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{locale?.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("words.intro")}</p>
      </div>
      {make.isSuccess ? (
        <StudySession
          scope={`lesson:${lesson.key}`}
          finished={(study) => <WordsLearnt learning={study.counts.learning} onDone={onDone} />}
        />
      ) : make.isError ? (
        <ErrorState
          error={make.error}
          onRetry={() => make.mutate({ series, lessonKey: lesson.key, edition })}
        />
      ) : (
        <Loading />
      )}
      <StepBar onBack={onBack} onNext={onNext} onSkip={onSkip} />
    </article>
  );
}

/** The lesson's words are studied for now: the step is done; learning cards come back in Review. */
function WordsLearnt({ learning, onDone }: { learning: number; onDone(): void }) {
  const { t } = useTranslation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: recorded once, when shown
  useEffect(() => onDone(), []);
  return (
    <div className="space-y-2 rounded-3xl border bg-card px-6 py-8 text-center">
      <h2 className="text-2xl font-bold">{t("words.learnt")}</h2>
      <p className="text-muted-foreground">{t("words.goOn", { count: learning })}</p>
    </div>
  );
}
