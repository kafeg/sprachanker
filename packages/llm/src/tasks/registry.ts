// The tasks whose system prompt the learner sees and may rewrite, in the order the
// settings show them: each one's standing rules and the characters of each context part it gets.
import { CHAT_TURN_BUDGETS, chatTurnRules } from "./chat-turn.ts";
import { CHECK_SPEAKING_BUDGETS, checkSpeakingRules } from "./check-speaking.ts";
import { CHECK_WRITING_BUDGETS, checkWritingRules } from "./check-writing.ts";
import { EXAM_CONVERSATION_BUDGETS, examConversationRules } from "./exam-conversation.ts";
import { EXPLAIN_MISTAKE_BUDGETS, explainMistakeRules } from "./explain-mistake.ts";
import { MISTAKE_ITEMS_BUDGETS, mistakeItemsRules } from "./mistake-items.ts";
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
import { TALK_BUDGETS, talkCardRules, talkCheckRules, talkCuesRules } from "./talk.ts";
import {
  UNDERSTANDING_BUDGETS,
  understandingCheckRules,
  understandingJudgeRules,
  understandingQuestionsRules,
  understandingTextRules,
} from "./understanding.ts";
import { WORD_EXAMPLES_BUDGETS, wordExamplesRules } from "./word-examples.ts";
import { WRITING_TASK_BUDGETS, writingTaskRules } from "./writing-task.ts";

interface TaskPromptEntry {
  rules: TaskRules;
  budgets: Readonly<Record<string, number>>;
}

export const TASK_PROMPTS = {
  explain: { rules: explainMistakeRules, budgets: EXPLAIN_MISTAKE_BUDGETS },
  tutor: { rules: chatTurnRules, budgets: CHAT_TURN_BUDGETS },
  tutorSection: { rules: sectionChatRules, budgets: SECTION_CHAT_BUDGETS },
  writingTask: { rules: writingTaskRules, budgets: WRITING_TASK_BUDGETS },
  writing: { rules: checkWritingRules, budgets: CHECK_WRITING_BUDGETS },
  speaking: { rules: checkSpeakingRules, budgets: CHECK_SPEAKING_BUDGETS },
  exam: { rules: rateExamAnswerRules, budgets: RATE_EXAM_ANSWER_BUDGETS },
  conversation: { rules: examConversationRules, budgets: EXAM_CONVERSATION_BUDGETS },
  // Its own key, not "understanding": a prompt written for the old one-shot text would not fit.
  understandingDraft: { rules: understandingTextRules, budgets: UNDERSTANDING_BUDGETS },
  understandingJudge: { rules: understandingJudgeRules, budgets: UNDERSTANDING_BUDGETS },
  understandingQuestions: {
    rules: understandingQuestionsRules,
    budgets: {
      lessonVocab: UNDERSTANDING_BUDGETS.lessonVocab,
      knownVocab: UNDERSTANDING_BUDGETS.knownVocab,
    },
  },
  understandingCheck: { rules: understandingCheckRules, budgets: {} },
  talkCard: { rules: talkCardRules, budgets: TALK_BUDGETS },
  talkCues: { rules: talkCuesRules, budgets: {} },
  talkCheck: { rules: talkCheckRules, budgets: TALK_BUDGETS },
  mistakes: { rules: mistakeItemsRules, budgets: MISTAKE_ITEMS_BUDGETS },
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
