// An open answer rated by its criteria (09, Exams; owner's choice K, 2026-10-10): each criterion with
// its levels as the exam's raters give them (points; what a level means on hover or long press), the
// points they make, saved — by the learner, or as the assistant proposed them (a proposal kept in the
// run for this answer, asked through the page's slot: chosen until changed, its reasons under each).
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

/** The latest rating saved for a question, the latest proposal for this answer, and what is chosen
 *  first: the later of the two (a proposal asked for after rating is shown chosen). */
function ratingsOf(events: TypedEvent[], itemKey: string, answer: string) {
  let rated: Record<string, number> | undefined;
  let proposal: (Proposal & { id: string }) | undefined;
  let first: Record<string, number> | undefined;
  for (const e of events) {
    if (e.itemKey !== itemKey) continue;
    if (e.type === "exam_rated") first = rated = e.payload.ratings;
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
  return { rated, proposal, first };
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
  const { rated, proposal, first } = ratingsOf(events, item.key, answer);
  return (
    <div className="space-y-2">
      {propose?.({ runId, itemKey: item.key, proposed: !!proposal, onStored: keep })}
      <RatingPanel
        // A proposal that comes is chosen until changed.
        key={proposal?.id ?? "self"}
        criteria={item.criteria}
        locale={locale}
        rated={rated}
        first={first}
        proposal={proposal}
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
  busy: boolean;
  onRate(ratings: Record<string, number>, taken: boolean): void;
}) {
  const { t } = useTranslation();
  const number = useNumber();
  const [chosen, setChosen] = useState<Record<string, number>>(() => first ?? {});
  const complete = criteria.every((c) => chosen[c.id] !== undefined);
  const max = criteria.reduce((n, c) => n + Math.max(...c.levels), 0);
  const voided = criteria.some((c) => c.voids && chosen[c.id] === 0);
  const points = voided ? 0 : criteria.reduce((n, c) => n + (chosen[c.id] ?? 0), 0);
  // Taken as proposed: the assistant's rating; changed anywhere: the learner's.
  const taken = !!proposal && criteria.every((c) => proposal.ratings[c.id] === chosen[c.id]);
  const changed = !rated || criteria.some((c) => rated[c.id] !== chosen[c.id]);
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
                <legend className="float-left text-sm font-medium">{texts?.title ?? c.id}</legend>
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
          {voided && <span className="ml-2 text-muted-foreground">{t("exams.rating.voided")}</span>}
        </span>
        <Button
          size="sm"
          disabled={!complete || !changed}
          loading={busy}
          onClick={() => onRate(chosen, taken)}
        >
          {rated ? t("exams.rating.change") : t("exams.rating.save")}
        </Button>
      </div>
    </div>
  );
}
