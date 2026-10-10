// An exam run's questions as the item cards show them, and the answers given to them.
import type { ExamItem, Exercise, Outcome, TypedEvent } from "@sprachanker/schema";

/** The questions of a run as an exercise of single-choice items (how item cards show them). */
export const asExercise = (key: string, items: ExamItem[]) =>
  ({
    key,
    type: "single_choice",
    fingerprint: "",
    newWords: [],
    ruleIds: [],
    items,
  }) as unknown as Exercise;

/** Each question's latest answer in a run, with its outcome where the run tells it. */
export function latestAnswers(events: TypedEvent[]) {
  const out = new Map<string, { answer: unknown; outcome?: Outcome }>();
  for (const e of events)
    if (e.type === "answered" && e.itemKey)
      out.set(e.itemKey, {
        answer: e.payload.answer,
        ...(e.payload.outcome && { outcome: e.payload.outcome }),
      });
  return out;
}
