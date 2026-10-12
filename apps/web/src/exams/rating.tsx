// An open answer rated by its criteria (09, Exams; owner's choice K, 2026-10-10): each criterion with
// its levels as the exam's raters give them (points; what a level means on hover or long press), the
// points they make, saved — by the learner, or as the assistant proposed them (a proposal kept in the
// run for this answer, asked through the page's slot: chosen until changed, its reasons under each;
// until accepted it scores nothing, the result counting the rating saved before — "Accept the
// proposal" or "Keep mine").
import { criteriaMax, ratedPoints } from "@sprachanker/engine";
import type { ExamItem, LocaleItem, TypedEvent } from "@sprachanker/schema";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useKeepRunEvents, useRateAnswer } from "@/api/exams.ts";
import { Button } from "@/ui/components/button.tsx";
import { errorText } from "@/ui/error-text.ts";
import { useNumber } from "@/ui/format.ts";
import { cn } from "@/ui/utils.ts";
import { useExamSlots } from "./slots.ts";

type Criteria = NonNullable<ExamItem["criteria"]>;

interface Proposal {
  ratings: Record<string, number>;
  notes: Record<string, string>;
  feedback: string;
  model: string;
}

/** The latest rating saved for a question (and its event's id), the latest proposal for this
 *  answer, and what is chosen first: the later of the two (a proposal asked for after rating is shown
 *  chosen — `pending` until it is accepted or the learner keeps theirs). */
function ratingsOf(events: TypedEvent[], itemKey: string, answer: string) {
  let rated: Record<string, number> | undefined;
  let ratedId: string | undefined;
  let proposal: (Proposal & { id: string }) | undefined;
  let first: Record<string, number> | undefined;
  for (const e of events) {
    if (e.itemKey !== itemKey) continue;
    if (e.type === "exam_rated") {
      first = rated = e.payload.ratings;
      ratedId = e.id;
    }
    if (e.type === "llm_verdict" && e.payload.task === "exam" && e.payload.input === answer) {
      const { criteria, feedback } = e.payload.result;
      proposal = {
        id: e.id,
        ratings: Object.fromEntries(criteria.map((c) => [c.id, c.points])),
        notes: Object.fromEntries(criteria.map((c) => [c.id, c.reason])),
        feedback,
        model: e.payload.model,
      };
      first = proposal.ratings;
    }
  }
  return { rated, ratedId, proposal, first, pending: !!proposal && first === proposal.ratings };
}

/** An open answer of a run rated: the assistant's proposal asked for (when it works here), the
 *  criteria chosen and saved; the result is computed anew. */
export function OpenAnswerRating({
  runId,
  item,
  locale,
  events,
  answer,
}: {
  runId: string;
  item: ExamItem & { criteria: Criteria };
  locale?: LocaleItem;
  events: TypedEvent[];
  answer: string;
}) {
  const { t } = useTranslation();
  const rate = useRateAnswer(runId);
  const keep = useKeepRunEvents(runId);
  const { propose } = useExamSlots();
  const { rated, ratedId, proposal, first, pending } = ratingsOf(events, item.key, answer);
  return (
    <div className="space-y-2">
      {propose?.({ runId, itemKey: item.key, proposed: !!proposal, onStored: keep })}
      <RatingPanel
        // Chosen anew when a proposal comes (chosen until changed) and when a rating is saved
        // (the learner's kept, or the proposal accepted).
        key={`${proposal?.id ?? "self"}/${ratedId ?? "unrated"}`}
        criteria={item.criteria}
        locale={locale}
        rated={rated}
        first={first}
        proposal={proposal}
        pending={pending}
        busy={rate.isPending}
        onRate={(ratings, taken) =>
          rate.mutate({
            itemKey: item.key,
            ratings,
            by: taken ? "assistant" : "self",
            ...(taken && proposal && { model: proposal.model }),
          })
        }
      />
      {rate.isError && (
        <p role="alert" className="text-sm text-destructive">
          {errorText(t, rate.error)}
        </p>
      )}
    </div>
  );
}

function RatingPanel({
  criteria,
  locale,
  rated,
  first,
  proposal,
  pending,
  busy,
  onRate,
}: {
  criteria: Criteria;
  locale?: LocaleItem;
  /** The ratings saved, if any. */
  rated?: Record<string, number>;
  /** What is chosen to begin with. */
  first?: Record<string, number>;
  /** Ratings proposed (the assistant's), with a reason per criterion: chosen until changed. */
  proposal?: Proposal;
  /** The proposal not accepted yet (nor the learner's own kept): it scores nothing so far. */
  pending: boolean;
  busy: boolean;
  onRate(ratings: Record<string, number>, taken: boolean): void;
}) {
  const { t } = useTranslation();
  const number = useNumber();
  const [chosen, setChosen] = useState<Record<string, number>>(() => first ?? {});
  const complete = criteria.every((c) => chosen[c.id] !== undefined);
  // As the result scores it (the engine's): a criterion that voids the answer, at 0, makes it 0.
  const max = criteriaMax(criteria);
  const points = ratedPoints(criteria, chosen);
  const voided = criteria.some((c) => c.voids && chosen[c.id] === 0);
  // A criterion that voids the answer, not rated yet: 0 until it is.
  const unrated = criteria.find((c) => c.voids && chosen[c.id] === undefined);
  // Taken as proposed: the assistant's rating; changed anywhere: the learner's.
  const taken = !!proposal && criteria.every((c) => proposal.ratings[c.id] === chosen[c.id]);
  const changed = !rated || criteria.some((c) => rated[c.id] !== chosen[c.id]);
  // The proposal shown as it came, not accepted yet: accepted, or the learner's own kept.
  const offered = pending && taken;
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      {proposal && (
        <div className="space-y-1 border-b pb-3 text-sm">
          <p className="flex items-center gap-1.5 text-muted-foreground">
            <Sparkles className="size-4" aria-hidden />{" "}
            {t("exams.rating.proposed", { model: proposal.model })}
          </p>
          {proposal.feedback && <p>{proposal.feedback}</p>}
        </div>
      )}
      <ul className="space-y-3">
        {criteria.map((c) => {
          const texts = locale?.criteria?.[c.id];
          return (
            <li key={c.id}>
              <fieldset className="flex flex-wrap items-center justify-between gap-2">
                <legend className="float-start text-sm font-medium">{texts?.title ?? c.id}</legend>
                <span className="flex gap-1">
                  {c.levels.map((level, i) => (
                    <button
                      key={level}
                      type="button"
                      aria-pressed={chosen[c.id] === level}
                      title={texts?.levels?.[i]}
                      onClick={() => setChosen((s) => ({ ...s, [c.id]: level }))}
                      className={cn(
                        "min-h-9 min-w-11 rounded-lg border px-2.5 text-sm tabular-nums pointer-coarse:min-h-11",
                        chosen[c.id] === level
                          ? "border-primary bg-primary/25 font-medium"
                          : "bg-card hover:bg-accent",
                      )}
                    >
                      {number(level)}
                    </button>
                  ))}
                </span>
              </fieldset>
              {proposal?.notes[c.id] && (
                <p className="mt-1 text-sm text-muted-foreground">{proposal.notes[c.id]}</p>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <span className="text-sm tabular-nums">
          {t("exams.points", { points, max })}
          {(voided || unrated) && (
            <span className="ms-2 text-muted-foreground">
              {voided
                ? t("exams.rating.voided")
                : t("exams.rating.unrated", {
                    criterion: (unrated && locale?.criteria?.[unrated.id]?.title) ?? unrated?.id,
                  })}
            </span>
          )}
        </span>
        {offered ? (
          <span className="flex flex-wrap gap-2">
            {rated && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onRate(rated, false)}
              >
                {t("exams.rating.keepMine")}
              </Button>
            )}
            <Button size="sm" loading={busy} onClick={() => onRate(chosen, true)}>
              {t("exams.rating.accept")}
            </Button>
          </span>
        ) : (
          <Button
            size="sm"
            disabled={!complete || !changed}
            loading={busy}
            onClick={() => onRate(chosen, taken)}
          >
            {rated ? t("exams.rating.change") : t("exams.rating.save")}
          </Button>
        )}
      </div>
      {pending && (
        <p className="text-sm text-muted-foreground">
          {t("exams.rating.notTaken", {
            points: rated ? ratedPoints(criteria, rated) : 0,
            max,
          })}
        </p>
      )}
    </div>
  );
}
