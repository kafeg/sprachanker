// Going over mistakes, in the lesson's summary while the pass has some (04, "AI practice in courses";
// 09): the pass's mistakes by type — at most three types, one at a time ("Type 1 of 3") —, each with
// the learner's wrong parts only, a short explanation and two or three new items of the type, checked
// by the server's engine as they are answered; the next type once these are answered, the score at
// the end. The review shown is the newest of the run the lesson shows; the lesson's other reviews are
// listed under it.
import { reviewAt } from "@sprachanker/engine";
import { ChevronLeft, ChevronRight, ListChecks } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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
import { ErrorLine, StartPrompt, Thinking } from "./parts.tsx";
import { PromptButton } from "./prompt-view.tsx";
import { useLlm } from "./setup-api.ts";

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

/** Going over the pass's mistakes in the summary: the latest review of the run the lesson shows
 *  (`runId`; none yet: a start), then the lesson's other ones. */
export function GoingOverSection({ runId, ...ids }: LessonSlotContext & { runId?: string }) {
  const { t, i18n } = useTranslation();
  const llm = useLlm();
  const start = useStartGoingOver(ids.lessonKey);
  const state = useGoingOver(ids.lessonKey, start.isPending);
  const reviews = state.data?.reviews ?? [];
  const current = runId ? reviews.find((r) => r.runId === runId) : undefined;
  const past = reviews.filter((r) => r !== current);
  if (!llm.data?.model || !state.data) return null;
  // Asked from here, or still being written on the server since before this page was opened.
  const preparing = start.isPending || state.data.preparing;
  const go = () => {
    if (!preparing) start.mutate({ ...ids, language: i18n.language });
  };
  return (
    <section className="space-y-3">
      <h2 className="font-heading text-xl font-semibold">{t("lesson.step.mistakes")}</h2>
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
        {preparing && (
          <Thinking
            label={t(`goingOver.step.${state.data.step ?? "making"}`)}
            className="text-sm"
          />
        )}
        <ErrorLine error={start.error} onRetry={preparing ? undefined : go} />
        <PastReviews reviews={past} />
      </div>
    </section>
  );
}
