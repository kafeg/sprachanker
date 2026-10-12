// Every task whose words reach the learner assumes no gender of theirs (07): its standing rules carry
// the NEUTRAL line, in English as every rule is.
import { expect, test } from "bun:test";
import { PROMPT_TASKS, type PromptTask, TASK_PROMPTS } from "../src/tasks/registry.ts";
import { NEUTRAL } from "../src/tasks/rules.ts";

/** Tasks whose words are never said to the learner nor about them, and why. */
const EXEMPT: Partial<Record<PromptTask, string>> = {
  // The model answers a text's questions blind: letters and short answers in the target language
  // that the app compares with the text's own, never shown.
  understandingCheck: "read by the app alone",
  // Sentences about their own people (a sentence's "ich" or "du" is its speaker's, set by the
  // sentence), translated as written; nothing in them addresses the learner or speaks of them.
  examples: "about no one the learner is",
};

test("every task speaking to the learner keeps their gender unassumed", () => {
  const without = PROMPT_TASKS.filter(
    (task) => !EXEMPT[task] && !TASK_PROMPTS[task].rules("ru", "de").includes(NEUTRAL),
  );
  expect(without).toEqual([]);
});

test("the tasks exempt are tasks without the line — none kept exempt after it is added", () => {
  const lacking = PROMPT_TASKS.filter(
    (task) => !TASK_PROMPTS[task].rules("ru", "de").includes(NEUTRAL),
  );
  expect(lacking.sort()).toEqual(Object.keys(EXEMPT).sort() as PromptTask[]);
});
