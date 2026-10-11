// Going over mistakes, a practice step of the lesson (04, "AI practice in courses"; 09): the pass's
// mistakes by type — at most three types, one at a time ("Type 1 of 3") —, each with the learner's
// wrong parts only, a short explanation and two or three new items of the type, checked by the
// server's engine as they are answered; the next type once these are answered, the score at the end.
// The review shown is the newest of the run the lesson shows; the step is done once its items are all
// answered, and skipped when the run has nothing to go over. The step is in the plan only while the
// pass has mistakes; the lesson's other reviews are listed under it.
import { reviewAt } from "@sprachanker/engine";
import { ChevronLeft, ChevronRight, ListChecks } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/api/client.ts";
import type { LessonSlotContext } from "@/lesson/slots.ts";
import {
  groupStart,
  MoreMistakes,
  ReviewedMistakes,
  ReviewGroup,
  reviewScore,
} from "@/library/mistakes-review.tsx";
import { Button } from "@/ui/components/button.tsx";
import { useDateFormat } from "@/ui/format.ts";
import { HistoryList } from "@/ui/history.tsx";
import { Panel } from "@/ui/panel.tsx";
import { useRequiredTargetLang } from "@/ui/target-lang.ts";
import { type Review, useAnswerGoingOver, useGoingOver, useStartGoingOver } from "./api.ts";
import { AssistantLabel, modelName } from "./assistant-label.tsx";
import { ErrorLine, StartPrompt } from "./parts.tsx";
import { PromptButton } from "./prompt-view.tsx";
import { useLlm } from "./setup-api.ts";

/** Whether every new item of a review is answered. */
const complete = (review: Review) =>
  reviewAt(review.result, (n) => review.answers.some((a) => a.question === n)) ===
  review.result.groups.length;

/** The run's latest review: one type at a time, the next once its items are answered. */
function CurrentReview({
  review,
  ids,
  preparing,
  onAgain,
}: {
  review: Review;
  ids: LessonSlotContext;
  preparing: boolean;
  onAgain(): void;
}) {
  const { t, i18n } = useTranslation();
  const lang = useRequiredTargetLang();
  const when = useDateFormat("dayTime");
  const answer = useAnswerGoingOver(ids.lessonKey);
  const { groups } = review.result;
  const answered = (n: number) => review.answers.some((a) => a.question === n);
  const at = reviewAt(review.result, answered);
  const done = at === groups.length;
  const [shown, setShown] = useState(Math.min(at, groups.length - 1));
  const group = groups[shown];
  if (!group) return null;
  const start = groupStart(review.result, shown);
  const groupDone = group.items.every((_, k) => answered(start + k));
  const send = (question: number, value: unknown) =>
    answer.mutate({ ...ids, language: i18n.language, id: review.id, question, answer: value });
  return (
    <Panel className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="me-auto text-sm text-muted-foreground" aria-live="polite">
          {[
            t("goingOver.group", { n: shown + 1, total: groups.length }),
            when.format(review.ts),
            review.model && modelName(review.model),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <PromptButton request={() => ({ mistakes: { ...ids, language: i18n.language } })} />
        <Button
          variant="outline"
          size="sm"
          loading={preparing}
          disabled={preparing}
          onClick={onAgain}
        >
          {preparing ? t("goingOver.preparing") : t("goingOver.again")}
        </Button>
      </div>
      <ReviewGroup
        key={shown}
        group={group}
        start={start}
        id={review.id}
        answers={review.answers}
        lang={lang}
        onAnswer={send}
      />
      <ErrorLine error={answer.error} />
      <div className="flex flex-wrap items-center gap-2">
        {shown > 0 && (
          <Button variant="outline" onClick={() => setShown(shown - 1)}>
            <ChevronLeft className="rtl:-scale-x-100" /> {t("goingOver.previous")}
          </Button>
        )}
        {shown < groups.length - 1 && (
          <Button disabled={!groupDone} onClick={() => setShown(shown + 1)}>
            {t("goingOver.next")} <ChevronRight className="rtl:-scale-x-100" />
          </Button>
        )}
        {done && reviewScore(review.result, review.answers).total > 0 && (
          <p className="font-semibold">
            {t("goingOver.result", reviewScore(review.result, review.answers))}
          </p>
        )}
      </div>
      <MoreMistakes review={review.result} />
    </Panel>
  );
}

/** Earlier reviews of the lesson, newest first; one opens to be read again with its answers. */
function PastReviews({ reviews }: { reviews: Review[] }) {
  const { t } = useTranslation();
  const lang = useRequiredTargetLang();
  const when = useDateFormat("dayTime");
  return (
    <HistoryList
      title={t("goingOver.past")}
      items={reviews}
      keyOf={(r) => r.id}
      summary={(r) => (
        <span className="flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate">
            {r.result.groups.map((g) => t(`goingOver.what.${g.what}`)).join(" · ")}
          </span>
          <span className="shrink-0 text-sm text-muted-foreground">
            {t("goingOver.result", reviewScore(r.result, r.answers))} · {when.format(r.ts)}
          </span>
        </span>
      )}
      detail={(r) => (
        <ReviewedMistakes id={r.id} review={r.result} answers={r.answers} lang={lang} />
      )}
    />
  );
}

/** The lesson's Going over mistakes step: the latest review of the run the lesson shows (`runId`;
 *  none yet: a start), then the lesson's other ones; `onDone` once its new items are all answered,
 *  `onNothing` when the run has nothing to go over. */
export function GoingOverStep({
  runId,
  onDone,
  onNothing,
  ...ids
}: LessonSlotContext & { runId?: string; onDone?(): void; onNothing?(): void }) {
  const { t, i18n } = useTranslation();
  const llm = useLlm();
  const state = useGoingOver(ids.lessonKey);
  const start = useStartGoingOver(ids.lessonKey);
  const reviews = state.data?.reviews ?? [];
  const current = runId ? reviews.find((r) => r.runId === runId) : undefined;
  const past = reviews.filter((r) => r !== current);
  // Done once the run's review is answered through: also when the reply to its last answer was lost
  // and the review is read again.
  const finished = !!current && complete(current);
  const nothing = start.error instanceof ApiError && start.error.message === "no_mistakes";
  // The latest callbacks, so a new one each render records nothing again.
  const on = useRef({ onDone, onNothing });
  on.current = { onDone, onNothing };
  useEffect(() => {
    if (finished) on.current.onDone?.();
  }, [finished]);
  useEffect(() => {
    if (nothing) on.current.onNothing?.();
  }, [nothing]);
  if (!llm.data?.model || !state.data) return null;
  // Asked from here, or still being written on the server since before this page was opened.
  const preparing = start.isPending || state.data.preparing;
  const go = () => {
    if (!preparing) start.mutate({ ...ids, language: i18n.language });
  };
  return (
    <div className="space-y-4">
      {current ? (
        <CurrentReview
          key={current.id}
          review={current}
          ids={ids}
          preparing={preparing}
          onAgain={go}
        />
      ) : (
        <Panel className="space-y-3">
          <StartPrompt
            intro={t("goingOver.intro")}
            label={preparing ? t("goingOver.preparing") : t("goingOver.start")}
            icon={ListChecks}
            loading={preparing}
            onStart={go}
          />
          <div className="flex flex-wrap items-center gap-2">
            <PromptButton request={() => ({ mistakes: { ...ids, language: i18n.language } })} />
            <AssistantLabel className="ms-auto" />
          </div>
        </Panel>
      )}
      <ErrorLine error={start.error} onRetry={preparing ? undefined : go} />
      <PastReviews reviews={past} />
    </div>
  );
}
