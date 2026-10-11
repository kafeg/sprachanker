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
  /** The most important first; at most three kept (older checks may hold more). */
  corrections: z.array(Correction).max(12),
  criteria: z.object({
    task: WritingCriterion,
    communication: WritingCriterion,
    accuracy: WritingCriterion,
  }),
  /** Each content point of the task, in its order: covered (2 fully, 1 partly, 0 not), and why.
   *  Checks of a text on the lesson's topic, before tasks had points, have none. */
  points: z.array(WritingCriterion).max(5).optional(),
  /** The task done well at the learner's level, with words they know, in the language learnt.
   *  Older checks have none. */
  modelText: z.string().max(3000).optional(),
  /** One or two encouraging, concrete sentences in the learner's language. */
  feedback: z.string(),
});
export type WritingCheck = z.infer<typeof WritingCheck>;

/** A writing task (`writing_task`; 04, "AI practice in courses"): a situation from the lesson and
 *  three content points to cover, as a language exam's writing part sets one (Goethe's Schreiben),
 *  in the learner's language; kept as an `llm_verdict` (`task: writing_task`) in the lesson run, the
 *  texts written on it checked against it. */
export const WritingTask = z.object({
  /** Who the learner writes to and why, one or two sentences. */
  situation: z.string().min(1).max(400),
  /** The three things the text must do ("say why you are late"). */
  points: z.array(z.string().min(1).max(200)).length(3),
  /** About how many words, by the course's level (the app's, not the model's). */
  words: z.number().int().positive(),
});
export type WritingTask = z.infer<typeof WritingTask>;

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

/** A Dialogue (a scene) as drafted (`scene_setup`), kept as its run's plan (04, "AI practice in
 *  courses"). */
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
  /** The first line in the learner's language (its "Translate"); scenes before it have none. */
  openingTranslation: z.string().optional(),
  /** What the partner knows and the learner must ask for (the information gap), in the target
   *  language; hidden from the learner until the Dialogue is over. Scenes before it have none. */
  partnerInfo: z.array(z.string()).max(5).optional(),
});
export type SceneSetup = z.infer<typeof SceneSetup>;

/** A Dialogue summed up once it ended (`scene_summary`), kept as an `llm_verdict` (`task:
 *  dialogue`) in its run: one or two key corrections, each with a model line — the learner's line
 *  said well —, and a line of feedback. The goals met are the run's own count. */
export const DialogueSummary = z.object({
  corrections: z.array(Correction.extend({ model: z.string() })).max(4),
  /** One or two encouraging, concrete sentences in the learner's language. */
  feedback: z.string(),
});
export type DialogueSummary = z.infer<typeof DialogueSummary>;

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

/** A question on an Understanding text (04, "AI practice in courses"), in the target language: a
 *  choice — true/false as two options in the target language, a/b/c, a number, price or time among
 *  three — or a short answer typed (a number, a price, a time, a name; the ways of writing it
 *  accepted). Shown and checked as the item of the closed type it is (`single_choice`, `gap_text`:
 *  engine `understandingExercise`), never by a model. */
export const UnderstandingQuestion = z.object({
  /** Asked while only listening (the text hidden), or with the text shown. */
  phase: z.enum(["listening", "reading"]),
  question: z.string().min(1).max(300),
  /** A choice's options and the right one's index (0-based); none for an answer typed. */
  options: z.array(z.string().min(1).max(200)).min(2).max(4).optional(),
  answer: z.number().int().nonnegative().optional(),
  /** An answer typed: every way of writing it that is right ("2,50", "2,50 Euro"). */
  accepted: z.array(z.string().min(1).max(100)).min(1).max(6).optional(),
});
export type UnderstandingQuestion = z.infer<typeof UnderstandingQuestion>;

/** What keeps a question from being asked: a choice needs its right option among them, an answer
 *  typed what is accepted; undefined when it holds. */
export function questionProblem(q: UnderstandingQuestion): string | undefined {
  if (q.options)
    return q.answer !== undefined && q.answer < q.options.length
      ? undefined
      : "a choice's answer is the index of one of its options";
  return q.accepted?.length ? undefined : "a question without options needs its accepted answers";
}

/** An Understanding text (`understanding_text`; 04): a dialogue of two or an announcement or
 *  message to listen to, or a text to read (a menu, a notice, a note, an ad), in the target
 *  language, with its questions; kept as an `llm_verdict` (`task: understanding`) in the lesson run,
 *  the learner's answers as `practice_answered` events on it. */
export const UnderstandingText = z.object({
  kind: z.enum(["dialogue", "announcement", "reading"]),
  /** Short title in the learner's language. */
  title: z.string().min(1).max(120),
  /** What it is, one sentence in the learner's language ("Two colleagues plan a meeting."). */
  situation: z.string().max(300),
  /** The text in the target language, a line each — a speaker's turn (with the speaker's name), a
   *  paragraph, a line of a menu. */
  lines: z
    .array(z.object({ speaker: z.string().max(40).optional(), text: z.string().min(1).max(600) }))
    .min(1)
    .max(40),
  /** The few words of the text beyond those known, as written there, with their translation. */
  glossary: z
    .array(z.object({ word: z.string().min(1).max(80), translation: z.string().min(1).max(120) }))
    .max(10),
  questions: z.array(UnderstandingQuestion).min(1).max(8),
});
export type UnderstandingText = z.infer<typeof UnderstandingText>;
