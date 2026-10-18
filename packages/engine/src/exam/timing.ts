// An exam's times beside its modules' (owner, 2026-10-18: as the real exam holds them): a Teil's own
// time — what its page states, else an equal share of its module's —, and a module's preparation
// (Goethe B1 Sprechen: 15 minutes with notes before its Teile) as a run holds it: begun when its
// first notes were kept, the notes as last kept, over once the Teile were begun or its time is gone.
import type { Exam, ExamNotesPayload, TypedEvent } from "@sprachanker/schema";

/** A Teil's time in seconds: its own, else its module's shared equally among the module's Teile;
 *  none for a Teil of no module (a test of drawn questions). */
export function teilTime(exam: Exam, sectionKey: string | undefined): number | undefined {
  const section = exam.sections.find((s) => s.key === sectionKey);
  if (!section) return undefined;
  if (section.timeLimitSec) return section.timeLimitSec;
  const module = exam.modules?.find((m) => m.id === section.module);
  if (!module) return undefined;
  const teile = exam.sections.filter((s) => s.module === module.id).length;
  return Math.round(module.timeLimitSec / teile);
}

/** A module's time to prepare in seconds; none when it has none. */
export const preparationOf = (exam: Exam, module: string | undefined) =>
  exam.modules?.find((m) => m.id === module)?.preparationSec;

export interface Preparation {
  /** When it began (the first notes kept, epoch ms); none: not yet. */
  began?: number;
  /** The notes on each question, as last kept. */
  notes: ExamNotesPayload["notes"];
  /** The Teile were begun. */
  done: boolean;
}

/** A module's preparation in a run's events. */
export function preparationIn(events: TypedEvent[], module: string): Preparation {
  const kept = events.flatMap((e) =>
    e.type === "exam_notes" && e.payload.module === module ? [e] : [],
  );
  return {
    ...(kept[0] && { began: kept[0].ts }),
    notes: kept.at(-1)?.payload.notes ?? {},
    done: kept.some((e) => e.payload.done),
  };
}

/** The time left to prepare (ms) at `now`: none once it is over. */
export function preparationLeft(
  preparation: Preparation,
  seconds: number,
  now: number,
): number | undefined {
  if (preparation.done) return undefined;
  // Never more than all of it (a clock a moment ahead of the one that kept its start).
  const left = Math.min(seconds * 1000, (preparation.began ?? now) + seconds * 1000 - now);
  return left > 0 ? left : undefined;
}
