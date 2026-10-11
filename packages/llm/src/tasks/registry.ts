// The tasks whose system prompt the learner sees and may rewrite (07, "Prompts"), in the order the
// settings show them: each one's standing rules and the characters of each context part it gets.
import { CHAT_TURN_BUDGETS, chatTurnRules } from "./chat-turn.ts";
import { CHECK_SPEAKING_BUDGETS, checkSpeakingRules } from "./check-speaking.ts";
import { CHECK_WRITING_BUDGETS, checkWritingRules } from "./check-writing.ts";
import { EXAM_CONVERSATION_BUDGETS, examConversationRules } from "./exam-conversation.ts";
import { EXPLAIN_MISTAKE_BUDGETS, explainMistakeRules } from "./explain-mistake.ts";
import { RATE_EXAM_ANSWER_BUDGETS, rateExamAnswerRules } from "./rate-exam-answer.ts";
import type { TaskRules } from "./rules.ts";
import {
  SCENE_BUDGETS,
  SCENE_SUMMARY_BUDGETS,
  sceneSetupRules,
  sceneSummaryRules,
  sceneTurnRules,
} from "./scene.ts";
import { SECTION_CHAT_BUDGETS, sectionChatRules } from "./section-chat.ts";
import { WORD_EXAMPLES_BUDGETS, wordExamplesRules } from "./word-examples.ts";

interface TaskPromptEntry {
  rules: TaskRules;
  budgets: Readonly<Record<string, number>>;
}

export const TASK_PROMPTS = {
  explain: { rules: explainMistakeRules, budgets: EXPLAIN_MISTAKE_BUDGETS },
  tutor: { rules: chatTurnRules, budgets: CHAT_TURN_BUDGETS },
  tutorSection: { rules: sectionChatRules, budgets: SECTION_CHAT_BUDGETS },
  writing: { rules: checkWritingRules, budgets: CHECK_WRITING_BUDGETS },
  speaking: { rules: checkSpeakingRules, budgets: CHECK_SPEAKING_BUDGETS },
  exam: { rules: rateExamAnswerRules, budgets: RATE_EXAM_ANSWER_BUDGETS },
  conversation: { rules: examConversationRules, budgets: EXAM_CONVERSATION_BUDGETS },
  sceneSetup: {
    rules: sceneSetupRules,
    budgets: {
      lessonVocab: SCENE_BUDGETS.lessonVocab,
      knownVocab: SCENE_BUDGETS.knownVocab,
      topics: SCENE_BUDGETS.topics,
      grammar: SCENE_BUDGETS.grammar,
    },
  },
  scene: { rules: sceneTurnRules, budgets: SCENE_BUDGETS },
  sceneSummary: { rules: sceneSummaryRules, budgets: SCENE_SUMMARY_BUDGETS },
  examples: { rules: wordExamplesRules, budgets: WORD_EXAMPLES_BUDGETS },
} as const satisfies Record<string, TaskPromptEntry>;

export type PromptTask = keyof typeof TASK_PROMPTS;
/** The tasks in the order the settings show them. */
export const PROMPT_TASKS = Object.keys(TASK_PROMPTS) as [PromptTask, ...PromptTask[]];
