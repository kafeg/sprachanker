// Going over mistakes: the new items the model sets for each type of
// mistake, as the items of the closed types they are — so they are shown and checked as any item,
// never by a model —, and where the learner is in a review: one type at a time, the next once its
// items are answered. A review's items are numbered across its groups (its answers' `question`).
import type {
  Exercise,
  MistakeItem,
  MistakeItemType,
  MistakesReview,
  Outcome,
} from "@sprachanker/schema";
import { checkItem } from "./index.ts";

const LETTERS = "abcdefghij";
const options = (texts: string[]) => texts.map((text, i) => ({ id: LETTERS[i] as string, text }));

/** A text with gaps written "___" as segments, the gaps g1, g2… in order. */
const segmentsOf = (text: string) =>
  text.split(/_{3,}/).flatMap((s, i) => (i ? [{ gap: `g${i}` }, ...(s ? [s] : [])] : s ? [s] : []));

/** The item of its type a new item is, as an exercise of that one item keyed `key`. */
export function mistakeItemExercise(type: MistakeItemType, m: MistakeItem, key = "m"): Exercise {
  const base = { key: `${key}#1`, ...(m.prompt && { prompt: m.prompt }) };
  const gaps = m.gaps ?? [];
  const item = (() => {
    switch (type) {
      case "single_choice":
        return {
          ...base,
          options: options(m.options ?? []),
          answer: { optionIds: [LETTERS[m.answer ?? 0]] },
        };
      case "gap_text":
        return {
          ...base,
          segments: segmentsOf(m.text ?? ""),
          answer: Object.fromEntries(
            gaps.map((g, i) => [`g${i + 1}`, { accepted: g.accepted ?? [] }]),
          ),
        };
      case "gap_choice":
        return {
          ...base,
          segments: segmentsOf(m.text ?? ""),
          gaps: Object.fromEntries(
            gaps.map((g, i) => [`g${i + 1}`, { options: options(g.options ?? []) }]),
          ),
          display: "dropdown",
          answer: Object.fromEntries(gaps.map((g, i) => [`g${i + 1}`, LETTERS[g.answer ?? 0]])),
        };
      case "order":
        return {
          ...base,
          parts: options(m.parts ?? []),
          join: "space",
          answer: { sequence: (m.parts ?? []).map((_, i) => LETTERS[i]) },
        };
      case "match": {
        const pairs = m.pairs ?? [];
        return {
          ...base,
          left: options(pairs.map((p) => p.left)),
          right: options(pairs.map((p) => p.right)),
          answer: { pairs: pairs.map((_, i) => [LETTERS[i], LETTERS[i]]) },
        };
      }
    }
  })();
  return {
    key,
    type,
    fingerprint: "",
    newWords: [],
    ruleIds: [],
    items: [item],
  } as unknown as Exercise;
}

/** A new item answered, checked as the item of its type it is, in the language learnt. Throws on an
 *  answer of the wrong shape. */
export const checkMistakeItem = (
  type: MistakeItemType,
  m: MistakeItem,
  answer: unknown,
  lang: string,
): Outcome => checkItem(mistakeItemExercise(type, m), 0, answer, lang);

/** A review's items in order across its groups: each with its group and its number in the review (a
 *  type listed only has none). */
export const reviewItems = (review: MistakesReview) =>
  review.groups
    .flatMap((g, group) => {
      const { type } = g;
      return type ? g.items.map((item) => ({ group, type, item })) : [];
    })
    .map((x, n) => ({ ...x, n }));

/**
 * Where the learner is in a review, `answered` telling its items answered by number: the first group
 * with an item still open — one type at a time —, or the number of groups once all are answered.
 */
export function reviewAt(review: MistakesReview, answered: (n: number) => boolean): number {
  const open = reviewItems(review).find((x) => !answered(x.n));
  return open ? open.group : review.groups.length;
}
