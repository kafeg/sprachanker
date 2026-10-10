// The learner's own system prompts (07, "Transparency and debugging"): templates per task with
// {language} and {target}, kept in the profile's settings; the tasks and their standing rules are the
// llm package's registry (TASK_PROMPTS).
import {
  languageName,
  PLACEHOLDER_NAMES,
  PROMPT_TASKS,
  type PromptTask,
  TASK_PROMPTS,
} from "@sprachanker/llm";
import type { Lang } from "@sprachanker/schema";
import type { Settings } from "./settings.ts";

/** The learner's own system prompts, by task. */
const PROMPTS = "llm.prompts" as const;

/** Placeholders a prompt template may hold: the answer language and the language learnt. */
const fill = (template: string, language: Lang, target: Lang) =>
  template
    .replaceAll("{language}", languageName(language))
    .replaceAll("{target}", languageName(target));

/** A task's system prompt as the settings show and edit it. */
export interface TaskPrompt {
  /** As sent for these languages. */
  system: string;
  /** The text to edit: the learner's own, or the standing rules with the languages as placeholders. */
  template: string;
  /** The learner's own prompt is in use. */
  custom: boolean;
  /** Characters of each context part it gets. */
  budgets: Record<string, number>;
}

export function createLlmPrompts(settings: Settings) {
  const customPrompts = (): Partial<Record<PromptTask, string>> => settings.get(PROMPTS) ?? {};
  return {
    /** System prompts of the tasks, as the settings show and edit them. */
    prompts(language: Lang, target: Lang): Record<PromptTask, TaskPrompt> {
      const own = customPrompts();
      return Object.fromEntries(
        PROMPT_TASKS.map((task) => {
          const custom = own[task];
          const { rules, budgets } = TASK_PROMPTS[task];
          const prompt: TaskPrompt = {
            system: custom ? fill(custom, language, target) : rules(language, target),
            template: custom ?? rules(language, target, PLACEHOLDER_NAMES),
            custom: !!custom,
            budgets: { ...budgets },
          };
          return [task, prompt];
        }),
      ) as Record<PromptTask, TaskPrompt>;
    },
    /** The learner's own system prompt of a task, filled in; undefined: the standing rules apply. */
    rulesFor(task: PromptTask, language: Lang, target: Lang): string | undefined {
      const custom = customPrompts()[task];
      return custom ? fill(custom, language, target) : undefined;
    },
    /** Saves the learner's own prompt of a task; null goes back to the standing rules. */
    setPrompt(task: PromptTask, template: string | null) {
      const { [task]: _, ...rest } = customPrompts();
      settings.set(PROMPTS, template?.trim() ? { ...rest, [task]: template } : rest);
    },
  };
}
