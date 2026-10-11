// A task's system prompt (07, "Prompts"): the learner's own rules for it (filled in) or its standing
// ones, then the fixed suffix that stays whatever the learner wrote — how the data is delimited, the
// reply's form and its languages.
import type { Lang } from "@sprachanker/schema";
import { languageName } from "../text.ts";

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

/** The reply's languages, whatever the rules: models drift into a third one (a Chinese or English
 *  word in a Russian explanation). */
export function languagesLine(language: Lang, target: Lang): string {
  const [l, t] = [languageName(language), languageName(target)];
  return `Write only in ${l === t ? t : `${l} and ${t}`}: not a word in any other language.`;
}

/** The system prompt as sent: the learner's rules or the standing ones, then the fixed suffix. */
export const systemPrompt = (input: RulesInput, standing: TaskRules, fixed: string) =>
  [
    input.rules ?? standing(input.language, input.target),
    fixed,
    languagesLine(input.language, input.target),
  ].join("\n");

/** Said in every rule set that addresses the learner or writes about them: their gender is never
 *  assumed. */
export const NEUTRAL =
  "The learner's gender is unknown: wherever a language would mark it (a translation, an explanation, feedback, your lines), choose wording that does not.";
