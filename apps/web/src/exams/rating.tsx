// An open answer rated by its criteria (owner's choice K, 2026-10-10): each criterion with
// its levels as the exam's raters give them (points; what a level means on hover or long press), the
// points they make, saved — by the learner, or as the assistant proposed them (a proposal kept in the
// run for this answer, asked through the page's slot: chosen until changed, its reasons under each;
// until accepted it scores nothing, the result counting the rating saved before — "Accept the
// proposal" or "Keep mine": one's own levels shown again, nothing stored anew — the rating counting is
// stored already —, the proposal set aside on this device).
import { criteriaMax, ratedPoints, selfRated } from "@sprachanker/engine";
import type { ExamItem, ExamRatingProposal, LocaleItem, TypedEvent } from "@sprachanker/schema";
import { Check, CircleDashed, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useKeepRunEvents, useRateAnswer } from "@/api/exams.ts";
import { KeptTake } from "@/audio/take-button.tsx";
import { CorrectedText, Corrections } from "@/ui/checked-text.tsx";
import { Button } from "@/ui/components/button.tsx";
import { inLang } from "@/ui/direction.tsx";
import { errorText } from "@/ui/error-text.ts";
import { useNumber } from "@/ui/format.ts";
import { useTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { useExamSlots } from "./slots.ts";

type Criteria = NonNullable<ExamItem["criteria"]>;

interface Proposal {
  ratings: Record<string, number>;
  notes: Record<string, string>;
  feedback: string;
  model: string;
  /** A written answer gone over: its content points, corrections, the text corrected, a model. */
  over: Pick<ExamRatingProposal, "points" | "corrections" | "corrected" | "modelText">;
}

/** Proposals set aside ("Keep mine") on this device, by their event's id. */
const keptKey = (proposal: string) => `sprachanker.exam-kept:${proposal}`;
const setAside = {
  has(proposal: string) {
    try {
      return localStorage.getItem(keptKey(proposal)) !== null;
    } catch {
      return false;
    }
  },
  add(proposal: string) {
    try {
      localStorage.setItem(keptKey(proposal), "1");
    } catch {
      // Storage blocked: set aside for this page only.
    }
  },
};

/** The latest rating saved for a question (and its event's id), the latest proposal for this
 *  answer, and what is chosen first: the later of the two (a proposal asked for after rating is shown
 *  chosen — `pending` until it is accepted or the learner keeps theirs: then one's own). */
function ratingsOf(
  events: TypedEvent[],
  itemKey: string,
  answer: string,
  kept: (proposal: string) => boolean,
) {
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
      const { criteria, feedback, points, corrections, corrected, modelText } = e.payload.result;
      proposal = {
        id: e.id,
        ratings: Object.fromEntries(criteria.map((c) => [c.id, c.points])),
        notes: Object.fromEntries(criteria.map((c) => [c.id, c.reason])),
        feedback,
        model: e.payload.model,
        over: { points, corrections, corrected, modelText },
      };
      first = proposal.ratings;
    }
  }
  if (proposal && rated && first === proposal.ratings && kept(proposal.id)) first = rated;
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
  points = [],
  auto = false,
  takes = [],
}: {
  runId: string;
  item: ExamItem & { criteria: Criteria };
  locale?: LocaleItem;
  events: TypedEvent[];
  answer: string;
  /** The task's content points (a writing task's), shown with how the answer did each. */
  points?: string[];
  /** The assistant's proposal asked at once (practice: the answer was just checked). */
  auto?: boolean;
  /** The learner's takes of a part said aloud: what pronunciation is rated by (the learner's own). */
  takes?: string[];
}) {
  const { t } = useTranslation();
  const rate = useRateAnswer(runId);
  const keep = useKeepRunEvents(runId);
  const { propose } = useExamSlots();
  const [kept, setKept] = useState<string[]>([]);
  const { rated, ratedId, proposal, first, pending } = ratingsOf(
    events,
    item.key,
    answer,
    (id) => kept.includes(id) || setAside.has(id),
  );
  return (
    <div className="space-y-2">
      {propose?.({ runId, itemKey: item.key, proposed: !!proposal, onStored: keep, auto })}
      {proposal && <GoneOver over={proposal.over} answer={answer} points={points} />}
      {item.criteria.some(selfRated) && (
        <div className="space-y-2 rounded-xl border bg-card p-4 text-sm">
          <p>{t("exams.rating.selfRated")}</p>
          {takes.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {takes.map((id, i) => (
                <KeptTake key={id} id={id} label={`${t("speech.mine")} ${i + 1}`} />
              ))}
            </div>
          )}
        </div>
      )}
      <RatingPanel
        // Chosen anew when a proposal comes (chosen until changed) and when a rating is saved
        // (the learner's kept, or the proposal accepted).
        key={`${proposal?.id ?? "self"}/${ratedId ?? "unrated"}/${pending}`}
        criteria={item.criteria}
        locale={locale}
        rated={rated}
        first={first}
        proposal={proposal}
        pending={pending}
        busy={rate.isPending}
        onKeep={() => {
          if (!proposal) return;
          setAside.add(proposal.id);
          setKept((k) => [...k, proposal.id]);
        }}
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

/** A written answer as the examiner went over it: each content point, the text corrected with its
 *  corrections, a model text. */
function GoneOver({
  over,
  answer,
  points,
}: {
  over: Proposal["over"];
  answer: string;
  points: string[];
}) {
  const { t } = useTranslation();
  const lang = useTargetLang();
  if (!over.points?.length && !over.corrections?.length && !over.modelText) return null;
  const Mark = ({ score }: { score: number }) =>
    score === 2 ? (
      <Check className="size-4 shrink-0 text-correct" aria-label={t("lesson.state.correct")} />
    ) : score === 1 ? (
      <CircleDashed className="size-4 shrink-0 text-wrong" aria-label={t("lesson.state.partial")} />
    ) : (
      <X className="size-4 shrink-0 text-wrong" aria-label={t("lesson.state.wrong")} />
    );
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      {over.points && over.points.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-sm font-medium">{t("writing.pointsTitle")}</h3>
          <ul className="space-y-1.5 text-sm">
            {over.points.map((p, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the task's points, in order
              <li key={i} className="flex items-start gap-2">
                <Mark score={p.score} />
                <span>
                  {points[i] && (
                    <span {...inLang(lang)} className="font-medium">
                      {points[i]}{" "}
                    </span>
                  )}
                  <span className="text-muted-foreground">{p.comment}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {over.corrections && over.corrections.length > 0 && (
        <div className="space-y-2">
          {/* A written answer corrected whole; a part said aloud, its corrections alone. */}
          {over.corrected && (
            <CorrectedText text={answer} corrected={over.corrected} className="text-base" />
          )}
          <Corrections corrections={over.corrections} />
        </div>
      )}
      {over.modelText && (
        <div className="rounded-lg bg-muted px-3 py-2">
          <h3 className="text-sm font-medium">{t("writing.modelText")}</h3>
          <p {...inLang(lang)}>{over.modelText}</p>
        </div>
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
  onKeep,
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
  /** One's own rating kept over the proposal (it is stored already). */
  onKeep(): void;
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
  // Taken as proposed: the assistant's rating; changed anywhere: the learner's (what the assistant
  // never rates — pronunciation — the learner's in either).
  const taken =
    !!proposal &&
    criteria
      .filter((c) => c.id in proposal.ratings)
      .every((c) => proposal.ratings[c.id] === chosen[c.id]);
  const changed = !rated || criteria.some((c) => rated[c.id] !== chosen[c.id]);
  // The proposal shown as it came, not accepted yet: accepted, or the learner's own kept.
  const offered = pending && taken;
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      {proposal && (
        <div className="space-y-1 border-b pb-3 text-sm">
          <p className="flex items-center gap-1.5 text-muted-foreground">
            <Sparkles className="size-4" aria-hidden />{" "}
            {pending
              ? t("exams.rating.proposed", { model: proposal.model })
              : rated &&
                  criteria
                    .filter((c) => c.id in proposal.ratings)
                    .every((c) => proposal.ratings[c.id] === rated[c.id])
                ? t("exams.rating.proposalTaken", { model: proposal.model })
                : t("exams.rating.proposalSetAside", { model: proposal.model })}
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
            <span className="text-muted-foreground">
              {" · "}
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
              <Button size="sm" variant="outline" disabled={busy} onClick={onKeep}>
                {t("exams.rating.keepMine")}
              </Button>
            )}
            <Button
              size="sm"
              loading={busy}
              disabled={!complete}
              onClick={() => onRate(chosen, true)}
            >
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
