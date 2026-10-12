// Every task whose words reach the learner assumes no gender of theirs (07): its standing rules carry
// the NEUTRAL line, in English as every rule is.
import { expect, test } from "bun:test";
import { PROMPT_TASKS, TASK_PROMPTS } from "../src/tasks/registry.ts";
import { NEUTRAL } from "../src/tasks/rules.ts";

/** Tasks that never address the learner: a check the app reads alone, sentences about no one. */
const NOT_TO_THE_LEARNER = new Set(["understandingCheck", "examples"]);

test("every task speaking to the learner keeps their gender unassumed", () => {
  const without = PROMPT_TASKS.filter(
    (task) =>
      !NOT_TO_THE_LEARNER.has(task) && !TASK_PROMPTS[task].rules("ru", "de").includes(NEUTRAL),
  );
  expect(without).toEqual([]);
});
