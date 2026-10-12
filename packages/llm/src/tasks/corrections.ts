// A checked text as kept (07): corrections that change nothing or quote words the text does not have
// dropped, an empty "corrected" filled with the text itself — models do all three —, and a good
// text's "corrected" its own words (a model may still rewrite it there). Shared by the checks of
// writing and speaking.
import type { Correction } from "@sprachanker/schema";

/** The words alone: case, punctuation and spacing aside (a recogniser chooses them). */
const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export const cleanCheck = <
  T extends { verdict: string; corrected: string; corrections: Correction[] },
>(
  check: T,
  text: string,
): T => {
  const said = ` ${words(text)} `;
  const corrections = check.corrections.filter(
    (c) => c.wrong.trim() !== c.right.trim() && said.includes(` ${words(c.wrong)} `),
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
