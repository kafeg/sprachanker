// Understanding (04, "AI practice in courses"): its questions as the items of the closed types they
// are — a choice a `single_choice`, an answer typed a `gap_text` —, so they are shown and checked as
// any item, never by a model; and where the learner is in a text: listening (the text hidden),
// reading (the text shown), done.
import type {
  Exercise,
  Outcome,
  UnderstandingQuestion,
  UnderstandingText,
} from "@sprachanker/schema";
import { checkItem } from "./index.ts";

const LETTERS = "abcdefgh";

/** A question as an exercise of its one item, keyed `key` (a question's own, the web's and the
 *  Notebook's: its text's id and number); its prompt the question. */
export function understandingExercise(q: UnderstandingQuestion, key = "q"): Exercise {
  const base = { key: `${key}#1`, prompt: q.question };
  const item = q.options
    ? {
        ...base,
        options: q.options.map((text, i) => ({ id: LETTERS[i], text })),
        answer: { optionIds: [LETTERS[q.answer ?? 0]] },
      }
    : { ...base, segments: [{ gap: "g1" }], answer: { g1: { accepted: q.accepted ?? [] } } };
  return {
    key,
    type: q.options ? "single_choice" : "gap_text",
    fingerprint: "",
    newWords: [],
    ruleIds: [],
    items: [item],
  } as unknown as Exercise;
}

/** A question checked as the item of its kind it is, in the text's language. Throws on an answer of
 *  the wrong shape. */
export const checkUnderstanding = (
  q: UnderstandingQuestion,
  answer: unknown,
  lang: string,
): Outcome => checkItem(understandingExercise(q), 0, answer, lang);

/** When a question is asked: a text to read has only questions on the text shown. */
/** The step a text is for: its own, or — made before the two steps — Reading's when it was to read. */
export const stepOf = (text: UnderstandingText): "reading" | "listening" =>
  text.step ?? (text.kind === "reading" ? "reading" : "listening");

export const questionPhase = (text: UnderstandingText, q: UnderstandingQuestion) =>
  text.kind === "reading" ? "reading" : q.phase;

/** The text is heard first, hidden (a dialogue, an announcement); a text to read is shown at once. */
export const heardFirst = (text: UnderstandingText) =>
  text.kind !== "reading" && text.questions.some((q) => q.phase === "listening");

/**
 * Where the learner is in a text, `answered` telling the questions answered by index: listening
 * while a question on the text heard is open (the text hidden), then reading (the text shown) while
 * one on the text read is, then done. The questions of each, in their order.
 */
export function understandingStage(text: UnderstandingText, answered: (n: number) => boolean) {
  const of = (phase: "listening" | "reading") =>
    text.questions.flatMap((q, n) => (questionPhase(text, q) === phase ? [n] : []));
  const listening = of("listening");
  const reading = of("reading");
  const stage = listening.some((n) => !answered(n))
    ? ("listening" as const)
    : reading.some((n) => !answered(n))
      ? ("reading" as const)
      : ("done" as const);
  return { stage, listening, reading };
}
