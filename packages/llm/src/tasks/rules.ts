// A task's system prompt (07, "Prompts"): the learner's own rules for it (filled in) or its standing
// ones, then the fixed suffix that stays whatever the learner wrote — how the data is delimited and
// the reply's form.
import type { Lang } from "@sprachanker/schema";

/** A task's standing rules for an answer language and a learnt language; `names` replaces the
 *  languages' names (the placeholders a template shows). */
export type TaskRules = (
  language: Lang,
  target: Lang,
  names?: { language: string; target: string },
) => string;

/** What a task's input carries for its system prompt. */
export interface RulesInput {
  /** The learner's own system prompt for the task, filled in (settings); the standing rules otherwise. */
  rules?: string;
  language: Lang;
  target: Lang;
}

/** The system prompt as sent: the learner's rules or the standing ones, then the fixed suffix. */
export const systemPrompt = (input: RulesInput, standing: TaskRules, fixed: string) =>
  `${input.rules ?? standing(input.language, input.target)}\n${fixed}`;
