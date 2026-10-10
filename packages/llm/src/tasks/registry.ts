// The tasks whose system prompt the learner sees and may rewrite (07, "Prompts"), in the order the
// settings show them: each one's standing rules and the characters of each context part it gets.
import { CHAT_TURN_BUDGETS, chatTurnRules } from "./chat-turn.ts";
import { CHECK_SPEAKING_BUDGETS, checkSpeakingRules } from "./check-speaking.ts";
import { CHECK_WRITING_BUDGETS, checkWritingRules } from "./check-writing.ts";
import { EXAM_CONVERSATION_BUDGETS, examConversationRules } from "./exam-conversation.ts";
import { EXPLAIN_MISTAKE_BUDGETS, explainMistakeRules } from "./explain-mistake.ts";
import { RATE_EXAM_ANSWER_BUDGETS, rateExamAnswerRules } from "./rate-exam-answer.ts";
import type { TaskRules } from "./rules.ts";
import { SCENE_BUDGETS, sceneSetupRules, sceneTurnRules } from "./scene.ts";
import { WORD_EXAMPLE_BUDGETS, wordExampleRules } from "./word-example.ts";

export interface TaskPromptEntry {
  rules: TaskRules;
  budgets: Readonly<Record<string, number>>;
}

export const TASK_PROMPTS = {
  explain: { rules: explainMistakeRules, budgets: EXPLAIN_MISTAKE_BUDGETS },
  tutor: { rules: chatTurnRules, budgets: CHAT_TURN_BUDGETS },
  writing: { rules: checkWritingRules, budgets: CHECK_WRITING_BUDGETS },
  speaking: { rules: checkSpeakingRules, budgets: CHECK_SPEAKING_BUDGETS },
  exam: { rules: rateExamAnswerRules, budgets: RATE_EXAM_ANSWER_BUDGETS },
  conversation: { rules: examConversationRules, budgets: EXAM_CONVERSATION_BUDGETS },
  sceneSetup: {
    rules: sceneSetupRules,
    budgets: { lessonVocab: SCENE_BUDGETS.lessonVocab, knownVocab: SCENE_BUDGETS.knownVocab },
  },
  scene: { rules: sceneTurnRules, budgets: SCENE_BUDGETS },
  example: { rules: wordExampleRules, budgets: WORD_EXAMPLE_BUDGETS },
} as const satisfies Record<string, TaskPromptEntry>;

export type PromptTask = keyof typeof TASK_PROMPTS;
/** The tasks in the order the settings show them. */
export const PROMPT_TASKS = Object.keys(TASK_PROMPTS) as [PromptTask, ...PromptTask[]];
