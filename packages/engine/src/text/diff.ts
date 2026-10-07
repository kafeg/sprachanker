// Word diff between a reference and an answer (dictation, speech).
import type { TokenDiff } from "@sprachanker/schema";
import { tokens, wordMatches } from "./normalise.ts";

export interface WordDiff {
  diff: TokenDiff[];
  /** Words matched of the reference or the answer, whichever has more: 0..1 (extra words cost). */
  score: number;
}

/** A word without surrounding punctuation: dictation and speech grade words, not commas. */
const bare = (word: string) => word.replace(/^[\p{P}]+|[\p{P}]+$/gu, "");

/** Words only: a dash or a lone punctuation mark is no word (a recogniser never writes one). */
const words = (text: string) => tokens(text).filter((t) => bare(t) !== "");

/** LCS-based alignment; a missing and an extra word at the same place become one `wrong`. */
export function wordDiff(
  lang: string,
  reference: string,
  actual: string,
  ignoreCase = false,
): WordDiff {
  const ref = words(reference);
  const got = words(actual);
  const eq = (i: number, j: number) =>
    wordMatches(lang, ref, i, got[j] ?? "", { ignoreCase, strip: bare });
  const lcs: number[][] = Array.from({ length: ref.length + 1 }, () =>
    Array(got.length + 1).fill(0),
  );
  for (let i = ref.length - 1; i >= 0; i--) {
    for (let j = got.length - 1; j >= 0; j--) {
      const row = lcs[i] as number[];
      row[j] = eq(i, j)
        ? (lcs[i + 1]?.[j + 1] ?? 0) + 1
        : Math.max(lcs[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const raw: TokenDiff[] = [];
  let i = 0;
  let j = 0;
  while (i < ref.length || j < got.length) {
    if (i < ref.length && j < got.length && eq(i, j)) {
      raw.push({ op: "equal", expected: ref[i++], actual: got[j++] });
    } else if (
      j < got.length &&
      (i >= ref.length || (lcs[i]?.[j + 1] ?? 0) >= (lcs[i + 1]?.[j] ?? 0))
    ) {
      raw.push({ op: "extra", actual: got[j++] });
    } else {
      raw.push({ op: "missing", expected: ref[i++] });
    }
  }
  const diff: TokenDiff[] = [];
  for (const d of raw) {
    const prev = diff[diff.length - 1];
    if (
      prev &&
      ((prev.op === "missing" && d.op === "extra") || (prev.op === "extra" && d.op === "missing"))
    ) {
      diff[diff.length - 1] = {
        op: "wrong",
        expected: prev.expected ?? d.expected,
        actual: prev.actual ?? d.actual,
      };
    } else diff.push(d);
  }
  const matched = diff.filter((d) => d.op === "equal").length;
  const longest = Math.max(ref.length, got.length);
  return { diff, score: longest ? matched / longest : 1 };
}
