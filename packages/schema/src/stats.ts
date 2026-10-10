// How every module reports its statistics (05, "Derived state"; 09, Notebook): the learner's work is
// counted per module — lessons, exams, review, the AI practice — by the kind of run it was done in, and
// each module gives its standing in one shape the Notebook shows without knowing the module.
import { z } from "zod";
import type { RunKind } from "./learner.ts";

/** The modules the learner works in: each has its runs, its counts and its standing. */
export const MODULES = ["lesson", "exam", "review", "ai"] as const;
export const ModuleId = z.enum(MODULES);
export type ModuleId = z.infer<typeof ModuleId>;

/** The module a run belongs to, by its kind: a tutor chat and a scene are the AI practice. */
export const MODULE_OF_KIND: Record<RunKind, ModuleId> = {
  lesson: "lesson",
  exam: "exam",
  review: "review",
  chat: "ai",
  scene: "ai",
};

const Count = z.number().int().nonnegative();

/** What a study day held (04, "Learner model"): each module's work counted — lesson work (answers,
 *  skips, steps), exam answers, card answers not taken back, the learner's messages and the checks
 *  asked of the model — and of the cards, the new ones learnt and those in review remembered. */
export const DayActivity = z.object({
  /** When the study day starts. */
  start: z.number().int(),
  ...({ lesson: Count, exam: Count, review: Count, ai: Count } satisfies Record<
    ModuleId,
    typeof Count
  >),
  /** Faces answered for the first time. */
  newCards: Count,
  /** Answers to faces already in review, and of them those not "Again". */
  recalled: Count,
  remembered: Count,
});
export type DayActivity = z.infer<typeof DayActivity>;
