// Outcomes the checkers share: right or wrong, graded, and an answer's words against its references
// (dictation typed, speech heard).
import { type WordDiff, wordDiff } from "../text/diff.ts";

/** Share of reference words needed for `partial` in dictation and speech. */
const PARTIAL_WORDS = 0.8;

export const binary = (ok: boolean) =>
  ({ result: ok ? "correct" : "wrong", score: ok ? 1 : 0 }) as const;
export const graded = (score: number, partialFrom = 0) =>
  ({
    result: score >= 1 ? "correct" : score > partialFrom && score > 0 ? "partial" : "wrong",
    score: Math.max(0, Math.min(1, score)),
  }) as const;

/** The reference the answer is closest to: an exact one first, then the best score. */
function bestDiff(lang: string, references: string[], actual: string, spoken: boolean) {
  const exact = (d: WordDiff) => d.diff.every((x) => x.op === "equal");
  const better = (a: WordDiff, b: WordDiff) =>
    exact(a) !== exact(b) ? exact(b) : b.score > a.score;
  return references
    .map((r) => wordDiff(lang, r, actual, spoken))
    .reduce((a, b) => (better(a, b) ? b : a));
}

/** An answer against its references (dictation typed; `spoken`: what a recogniser heard). */
export function textOutcome(lang: string, references: string[], actual: string, spoken: boolean) {
  const { diff, score } = bestDiff(lang, references, actual, spoken);
  const exact = diff.every((d) => d.op === "equal");
  return { ...(exact ? binary(true) : graded(Math.min(score, 0.99), PARTIAL_WORDS - 0.001)), diff };
}

/** How a spoken phrase went: every word heard ("correct"), most of them — at least 80%,
 *  "partial" — or too few ("wrong"). */
type SpokenVerdict = "correct" | "partial" | "wrong";

/** What was heard against the line to say (or the closest of its alternatives): the words matched
 *  and missed, the verdict, and the share of the line's words said (`score`). */
export function spokenCheck(lang: string, reference: string | string[], transcript: string) {
  const references = typeof reference === "string" ? [reference] : reference;
  const { diff, result, score } = textOutcome(lang, references, transcript, true);
  return { diff, verdict: result as SpokenVerdict, score };
}
