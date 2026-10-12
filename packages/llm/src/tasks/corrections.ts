// A checked text as kept: corrections that change nothing or quote words the text does not have
// (its pieces apart, a compound, a number in digits allowed for), an empty "corrected" filled with the text itself — models do all three —, and a good
// text's "corrected" its own words (a model may still rewrite it there). Shared by the checks of
// writing and speaking.
import type { Correction } from "@sprachanker/schema";

/** The words alone: case, punctuation and spacing aside (a recogniser chooses them). */
const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const isNumber = (word: string) => /^\p{N}+$/u.test(word);

/** Two words alike: the same, or a number in digits beside a word (the recogniser writes "3" for
 *  "drei"; the words around it say whether it is the place). */
const alike = (a: string, b: string) => a === b || isNumber(a) !== isNumber(b);

/** Where `piece` (words) stands in `text` (words) from `from` on: the index after it, -1 when absent.
 *  Its words in a row, or whole words of the text written together or apart as the piece's are
 *  ("Fahrrad fahren" for "fahrradfahren"). */
function after(text: string[], piece: string[], from: number) {
  const together = piece.join("");
  for (let i = from; i < text.length; i++) {
    if (piece.every((w, k) => alike(w, text[i + k] ?? ""))) return i + piece.length;
    let joined = "";
    for (let j = i; j < text.length && joined.length < together.length; j++) {
      joined += text[j];
      if (joined === together) return j + 1;
    }
  }
  return -1;
}

/** Whether `text` has the words `wrong` quotes: its pieces ("habe … gegangen") each in a row, in
 *  order; an empty `wrong` (a word left out) quotes nothing and is kept. */
export function quotes(text: string, wrong: string) {
  const pieces = wrong
    .split(/…|\.{3}/)
    .map((p) => words(p))
    .filter(Boolean);
  const said = words(text).split(" ");
  let at = 0;
  for (const piece of pieces) if (at >= 0) at = after(said, piece.split(" "), at);
  return at >= 0;
}

/** Whether word `w` is part of one of `others` or holds one: a compound written together or apart. */
const within = (w: string, others: string[]) =>
  others.some((s) => (s.length >= 4 && w.includes(s)) || (w.length >= 4 && s.includes(w)));

/** A word of a checked text's "corrected" that is neither the text's nor a correction's — a heard word
 *  spelled anew ("Friisör") —, and with `dropped` a word of the text gone from it without a
 *  correction quoting it (a writing check's "Hallo zusammen!" made "Hallo!"): the problem the check
 *  is asked again once for. A compound written apart or together, and a number said as a word for
 *  the recogniser's digits, are no change. */
export function unlistedChange(
  check: { corrected: string; corrections: Correction[] },
  text: string,
  dropped = false,
): string | undefined {
  if (!check.corrected.trim()) return undefined;
  const said = words(text).split(" ").filter(Boolean);
  const made = words(check.corrected).split(" ").filter(Boolean);
  const listed = new Set([...said, ...check.corrections.flatMap((c) => words(c.right).split(" "))]);
  const changed = made.filter((w) => !listed.has(w) && !isNumber(w) && !within(w, said));
  const digits = said.filter(isNumber).length;
  if (changed.length > digits)
    return `"corrected" makes only the changes "corrections" list: "${changed[0]}" is neither in the text nor a correction's`;
  if (!dropped) return undefined;
  const quoted = new Set([...made, ...check.corrections.flatMap((c) => words(c.wrong).split(" "))]);
  const gone = said.find((w) => !quoted.has(w) && !isNumber(w) && !within(w, made));
  return gone
    ? `"corrected" makes only the changes "corrections" list: "${gone}" of the text is left out without a correction quoting it`
    : undefined;
}

export const cleanCheck = <
  T extends { verdict: string; corrected: string; corrections: Correction[] },
>(
  check: T,
  text: string,
): T => {
  const corrections = check.corrections.filter(
    (c) => c.wrong.trim() !== c.right.trim() && quotes(text, c.wrong),
  );
  const corrected = check.corrected.trim() || text.trim();
  // Nothing to correct: the text as written, unless the model only set its case and punctuation.
  const good = check.verdict === "good" && !corrections.length;
  return {
    ...check,
    corrected: good && words(corrected) !== words(text) ? text.trim() : corrected,
    corrections,
  };
};
