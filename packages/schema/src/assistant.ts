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

/** The AI practice steps an Understanding text is made for (04, "AI practice in courses"): read, or
 *  heard first with the text shown once its questions are answered. */
export const PracticeStep = z.enum(["reading", "listening"]);
export type PracticeStep = z.infer<typeof PracticeStep>;

/** A person in a text (a speaker, a sender): their gender and age, which their voice follows. */
export const TextPerson = z.object({
  name: z.string().min(1).max(40),
  gender: z.enum(["f", "m"]),
  age: z.enum(["young", "adult", "senior"]),
});
export type TextPerson = z.infer<typeof TextPerson>;

/** How the drafts' judge rated the text kept, 1–5 each, and how many drafts there were. */
export const TextRating = z.object({
  natural: z.number().int().min(1).max(5),
  coherent: z.number().int().min(1).max(5),
  realistic: z.number().int().min(1).max(5),
  level: z.number().int().min(1).max(5),
  lesson: z.number().int().min(1).max(5),
  interest: z.number().int().min(1).max(5),
  drafts: z.number().int().min(1),
});
export type TextRating = z.infer<typeof TextRating>;

/** An Understanding text (04): a dialogue or a text one person says to listen to, or a text to
 *  read (a letter, a chat, a notice, a story), in the target language, with its questions; kept as
 *  an `llm_verdict` (`task: understanding`) in the lesson run, the learner's answers as
 *  `practice_answered` events on it. Texts before Reading and Listening have no `step` (a text to
 *  read is `kind: reading`), nor people, voices or rating. */
export const UnderstandingText = z.object({
  kind: z.enum(["dialogue", "announcement", "reading"]),
  /** The step it is for; none: a text before the two steps. */
  step: PracticeStep.optional(),
  /** Its genre (`TEXT_GENRES`' id). */
  genre: z.string().max(40).optional(),
  /** Short title in the learner's language. */
  title: z.string().min(1).max(120),
  /** What it is, one sentence in the learner's language ("Two colleagues plan a meeting."). */
  situation: z.string().max(300),
  /** What kind of text and where, in a few words of the learner's language, giving nothing of its
   *  content away ("A voice message", "A letter from a friend"): all a step shows before its
   *  questions are checked — the title and situation come after. Texts before it have none. */
  setting: z.string().max(120).optional(),
  /** The people speaking or writing, with what their voices follow. */
  people: z.array(TextPerson).max(4).optional(),
  /** The server's voices of its speakers, chosen when it was made: the engine and each one's voice. */
  voices: z
    .object({ engine: z.enum(["piper", "qwen"]), by: z.record(z.string(), z.string()) })
    .optional(),
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
  questions: z.array(UnderstandingQuestion).min(1).max(10),
  rating: TextRating.optional(),
});
export type UnderstandingText = z.infer<typeof UnderstandingText>;

/** The closed types Going over mistakes sets new items of (04, "AI practice in courses"): an
 *  exercise's own type, or the nearest of these (a multiple choice → one answer; dictation and
 *  speech → a gap typed). */
export const MistakeItemType = z.enum([
  "single_choice",
  "gap_text",
  "gap_choice",
  "order",
  "match",
]);
export type MistakeItemType = z.infer<typeof MistakeItemType>;

/** What went wrong in a part of an item: a word's ending, another word, the option chosen, the
 *  order of words, the order of sentences, a pair, a word's spelling; listed only, without new items
 *  (04): an answer said aloud, an Understanding question on a text heard or read (their group:
 *  comprehension). */
export const MistakeKind = z.enum([
  "ending",
  "word",
  "choice",
  "order",
  "sentence_order",
  "pair",
  "spelling",
  "spoken",
  "misheard",
  "misread",
  "comprehension",
]);
export type MistakeKind = z.infer<typeof MistakeKind>;

/** One wrong part of a mistake — a gap, a pair, a choice, an order, words written or said — and only
 *  it (engine `wrongParts`): what the learner gave, what is right, the words around it (a gap marked
 *  [_], the other gaps filled right). */
export const WrongPart = z.object({
  /** The item it is in (an Understanding question: its text's verdict and number). */
  itemKey: z.string(),
  what: MistakeKind,
  given: z.string(),
  right: z.string(),
  context: z.string().optional(),
  /** An Understanding question's: the line of its text the right answer is in, when one is. */
  line: z.string().optional(),
});
export type WrongPart = z.infer<typeof WrongPart>;

/** The marker of a gap in a new item's text. */
export const GAP_MARK = /_{3,}/g;

/** A new item Going over mistakes sets, in the target language, in one flat shape for every type
 *  (`mistake_items`); shown and checked as an item of its group's type (engine
 *  `mistakeItemExercise`), never by a model. */
export const MistakeItem = z.object({
  /** A choice's question; an instruction line for the others, if any. */
  prompt: z.string().min(1).max(300).optional(),
  /** single_choice: the options and the right one's index (0-based). */
  options: z.array(z.string().min(1).max(200)).min(2).max(4).optional(),
  answer: z.number().int().nonnegative().optional(),
  /** gap_text, gap_choice: the sentence with each gap written "___". */
  text: z.string().min(1).max(400).optional(),
  /** Each gap in order: typed — every right way of writing it; chosen — its options and the right
   *  one's index. */
  gaps: z
    .array(
      z.object({
        accepted: z.array(z.string().min(1).max(100)).min(1).max(6).optional(),
        options: z.array(z.string().min(1).max(100)).min(2).max(4).optional(),
        answer: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1)
    .max(4)
    .optional(),
  /** order: the parts (words or phrases) in the right order. */
  parts: z.array(z.string().min(1).max(120)).min(3).max(10).optional(),
  /** match: the pairs, each left with its right. */
  pairs: z
    .array(z.object({ left: z.string().min(1).max(120), right: z.string().min(1).max(120) }))
    .min(3)
    .max(6)
    .optional(),
});
export type MistakeItem = z.infer<typeof MistakeItem>;

/** A sentence's words for comparing: lower case, a gap one mark, cues in brackets and punctuation
 *  aside. */
const sentenceWords = (text: string) =>
  ` ${text
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/_{3,}|\[_\]/g, " _ ")
    .replace(/[^\p{L}\p{N}_]+/gu, " ")
    .trim()} `;

/** Whether a new item's sentence is one of the mistakes' again (three words or more, within it). */
const repeats = (sentence: string, mistake: string) => {
  const a = sentenceWords(sentence);
  const b = sentenceWords(mistake);
  return a.trim().split(" ").length >= 3 && b.includes(a);
};

/** A typed gap's cue: the base form or the learner-language word in brackets right after it. */
const CUED_GAP = /_{3,}\s*\([^)]+\)/g;

/** What keeps a new item from being set as an item of `type` — the mistakes it is set for given, a
 *  sentence of theirs again —; undefined when it holds. */
export function mistakeItemProblem(
  type: MistakeItemType,
  item: MistakeItem,
  mistakes: Array<Pick<WrongPart, "right" | "context">> = [],
): string | undefined {
  const index = (options: string[] | undefined, answer: number | undefined) =>
    !!options && answer !== undefined && answer < options.length;
  const distinct = (texts: string[] = []) =>
    new Set(texts.map((t) => t.trim().toLowerCase())).size === texts.length;
  const sentence =
    type === "order" ? (item.parts ?? []).join(" ") : type === "match" ? "" : (item.text ?? "");
  const again = [sentence, type === "single_choice" ? (item.prompt ?? "") : ""].some((s) =>
    mistakes.some((m) => [m.context, m.right].some((t) => t && repeats(s, t))),
  );
  if (again) return "a new sentence, never one of the mistakes again";
  switch (type) {
    case "single_choice":
      if (!item.prompt || !index(item.options, item.answer))
        return 'a choice needs "prompt", "options" and "answer" (the right option\'s index)';
      return distinct(item.options) ? undefined : "options all different";
    case "gap_text":
    case "gap_choice": {
      const marks = item.text?.match(GAP_MARK)?.length ?? 0;
      if (!marks || marks !== item.gaps?.length)
        return 'a gap item needs "text" with each gap written ___ and one entry of "gaps" for each';
      if (type === "gap_choice") {
        if (!item.gaps.every((g) => index(g.options, g.answer)))
          return 'each gap needs "options" and "answer" (the right option\'s index)';
        return item.gaps.every((g) => distinct(g.options))
          ? undefined
          : "each gap's options all different";
      }
      if (!item.gaps.every((g) => g.accepted?.length)) return 'each gap needs "accepted"';
      // A typed gap without a cue lets other right words in, marked wrong.
      return item.prompt || item.text?.match(CUED_GAP)?.length === marks
        ? undefined
        : "each typed gap followed by its cue in brackets: ___ (base form), or the word in the learner's language";
    }
    case "order":
      return item.parts ? undefined : 'an order item needs "parts" in the right order';
    case "match": {
      const pairs = item.pairs ?? [];
      return pairs.length &&
        distinct(pairs.map((p) => p.left)) &&
        distinct(pairs.map((p) => p.right))
        ? undefined
        : 'a match item needs "pairs", each left and each right once';
    }
  }
}

/** A type of mistakes gone over: its wrong parts, a short explanation and new items of the type,
 *  answered as `practice_answered` events on the review (counted across its groups). A type listed
 *  only (an answer said aloud, Understanding's questions) has no item type, explanation nor items. */
export const MistakeGroup = z.object({
  type: MistakeItemType.optional(),
  what: MistakeKind,
  mistakes: z.array(WrongPart).min(1).max(8),
  /** The rule or pattern behind them, short, in the learner's language; empty for a type listed. */
  explanation: z.string(),
  items: z.array(MistakeItem).max(3),
});
export type MistakeGroup = z.infer<typeof MistakeGroup>;

/** Going over a pass's mistakes (`mistake_items`; 04): its mistakes by type — at most three with new
 *  items, then those listed only —, kept as an `llm_verdict` (`task: mistakes`) in the lesson run.
 *  `more`: the wrong parts left out, beyond the types and parts shown. */
export const MistakesReview = z.object({
  groups: z.array(MistakeGroup).min(1).max(6),
  more: z.number().int().positive().optional(),
});
export type MistakesReview = z.infer<typeof MistakesReview>;
