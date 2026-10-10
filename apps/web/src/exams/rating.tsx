// An open answer rated by its criteria (09, Exams; owner's choice K, 2026-10-10): each criterion with
// its levels as the exam's raters give them (points; what a level means on hover or long press), the
// points they make, saved — by the learner, or as the assistant proposed them (`proposal`).
import type { ExamItem, LocaleItem } from "@sprachanker/schema";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/button.tsx";
import { useNumber } from "@/ui/format.ts";
import { cn } from "@/ui/utils.ts";

type Criteria = NonNullable<ExamItem["criteria"]>;

export function RatingPanel({
  criteria,
  locale,
  rated,
  proposal,
  busy,
  onRate,
}: {
  criteria: Criteria;
  locale?: LocaleItem;
  /** The ratings saved, if any. */
  rated?: Record<string, number>;
  /** Ratings proposed (the assistant's), with a note per criterion: chosen until changed. */
  proposal?: { ratings: Record<string, number>; notes?: Record<string, string> };
  busy: boolean;
  onRate(ratings: Record<string, number>, taken: boolean): void;
}) {
  const { t } = useTranslation();
  const number = useNumber();
  const [chosen, setChosen] = useState<Record<string, number>>(
    () => rated ?? proposal?.ratings ?? {},
  );
  const complete = criteria.every((c) => chosen[c.id] !== undefined);
  const max = criteria.reduce((n, c) => n + Math.max(...c.levels), 0);
  const voided = criteria.some((c) => c.voids && chosen[c.id] === 0);
  const points = voided ? 0 : criteria.reduce((n, c) => n + (chosen[c.id] ?? 0), 0);
  // Taken as proposed: the assistant's rating; changed anywhere: the learner's.
  const taken = !!proposal && criteria.every((c) => proposal.ratings[c.id] === chosen[c.id]);
  const changed = !rated || criteria.some((c) => rated[c.id] !== chosen[c.id]);
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
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
              {proposal?.notes?.[c.id] && (
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
