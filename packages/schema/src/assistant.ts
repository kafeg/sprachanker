// What the AI assistant's answers are, as they are kept (05, "Events"; 07): each task's structured
// result stored in an `llm_verdict` or a scene run's plan. Read back with these schemas; the tasks in
// packages/llm ask the models for them.
import { z } from "zod";

/** A mistake in the learner's text and its fix (a writing check, a scene line). */
export const Correction = z.object({
  wrong: z.string(),
  right: z.string(),
  explanation: z.string(),
});
export type Correction = z.infer<typeof Correction>;

/** A criterion of the writing check: 0 not met · 1 partly · 2 fully, and why. */
const WritingCriterion = z.object({
  score: z.number().int().min(0).max(2),
  comment: z.string(),
});

/** "Write it yourself" checked (`check_writing`). */
export const WritingCheck = z.object({
  verdict: z.enum(["good", "minor_errors", "major_errors", "off_task"]),
  /** The learner's text with the errors corrected, changed as little as possible. */
  corrected: z.string(),
  corrections: z.array(Correction).max(12),
  criteria: z.object({
    task: WritingCriterion,
    communication: WritingCriterion,
    accuracy: WritingCriterion,
  }),
  /** One or two encouraging, concrete sentences in the learner's language. */
  feedback: z.string(),
});
export type WritingCheck = z.infer<typeof WritingCheck>;

/** A model's check of an answer said aloud without a phrase to say (08, "Checking speech"), from what
 *  the recogniser heard; kept as an `llm_verdict` (`task: speaking`) on the item. */
export const SpokenCheck = z.object({
  verdict: z.enum(["good", "minor_errors", "major_errors", "off_task"]),
  /** The learner's answer with its errors corrected, changed as little as possible. */
  corrected: z.string(),
  corrections: z.array(Correction).max(8),
  /** One or two encouraging, concrete sentences in the learner's language. */
  feedback: z.string(),
});
export type SpokenCheck = z.infer<typeof SpokenCheck>;

/** The assistant's rating of an exam's open answer by the exam's criteria (`rate_exam_answer`), kept
 *  as an `llm_verdict` (`task: exam`) on the question; the learner takes it or changes it (09). */
export const ExamRatingProposal = z.object({
  /** Each criterion once: the points of the level chosen (one of its levels) and why. */
  criteria: z
    .array(
      z.object({
        id: z.string(),
        points: z.number().nonnegative(),
        /** Why this level, in the learner's language. */
        reason: z.string(),
      }),
    )
    .min(1)
    .max(12),
  /** One or two concrete sentences in the learner's language: what would score more. */
  feedback: z.string(),
});
export type ExamRatingProposal = z.infer<typeof ExamRatingProposal>;

/** An example sentence for a word: one of `word_examples` (a deck's words); kept alone by the
 *  one-at-a-time `word_example` of earlier versions (its stored verdicts still read). */
export const WordExample = z.object({
  sentence: z.string().min(1).max(300),
  translation: z.string().min(1).max(400),
  /** Words of the sentence beyond the known ones and the word, as written there, translated. */
  glossary: z.array(z.object({ word: z.string(), translation: z.string() })).max(10),
});
export type WordExample = z.infer<typeof WordExample>;

/** Examples for a few words of a deck at once (`word_examples`): each word by its number in the
 *  request (1, 2, …) with its sentences, each with the word as it uses it ("kann" of "können", "lädt
 *  ein" of "einladen": forms no rule finds). */
export const WordExamples = z.object({
  words: z
    .array(
      z.object({
        n: z.number().int().min(1),
        examples: z
          .array(WordExample.extend({ form: z.string().min(1).max(80) }))
          .min(1)
          .max(8),
      }),
    )
    .max(20),
});
export type WordExamples = z.infer<typeof WordExamples>;

/** A scene as drafted (`scene_setup`), kept as its run's plan. */
export const SceneSetup = z.object({
  /** Short title in the learner's language. */
  title: z.string(),
  /** Where and who, in the learner's language (two sentences at most). */
  situation: z.string(),
  /** Who the model plays, in the learner's language. */
  partner: z.string(),
  /** What the learner should achieve, in the learner's language. */
  goals: z.array(z.string()).min(1).max(3),
  /** The partner's first line, in the target language. */
  opening: z.string(),
});
export type SceneSetup = z.infer<typeof SceneSetup>;

/** The next lines of an exam's speaking part (`exam_conversation`): the examiner's and the partner's
 *  up to the learner's turn, each kept as an `llm_turn` with its `speaker` on the question. */
export const ExamConversationTurn = z.object({
  lines: z
    .array(z.object({ speaker: z.enum(["examiner", "partner"]), text: z.string() }))
    .min(1)
    .max(4),
  /** The part is over (the examiner closed it). */
  done: z.boolean(),
});
export type ExamConversationTurn = z.infer<typeof ExamConversationTurn>;
