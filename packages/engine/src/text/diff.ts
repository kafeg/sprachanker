// Word diff between a reference and an answer (dictation, speech).
import type { TokenDiff } from "@sprachanker/schema";
import { wordMatches, writtenTokens } from "./normalise.ts";

export interface WordDiff {
  diff: TokenDiff[];
  /** Words matched of the reference or the answer, whichever has more: 0..1 (extra words cost). */
  score: number;
}

/** A word without surrounding punctuation and symbols: dictation and speech grade words, not commas
 *  or marks ("≈", "→"). */
const bare = (word: string) => word.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "");

/** Words only, as written (a text shown corrected keeps its final mark): a dash or a lone mark is
 *  no word (a recogniser never writes one). */
const words = (text: string) => writtenTokens(text).filter((t) => bare(t) !== "");

/** A word as it sounds: case and hyphens are not heard ("Good-bye", "goodbye"). */
const heard = (lang: string, word: string) => bare(word).replace(/-/g, "").toLocaleLowerCase(lang);

/**
 * LCS-based alignment; a missing and an extra word at the same place become one `wrong`. `spoken`:
 * the answer is what a recogniser heard, so case is not compared and neither is how words are
 * joined — one word heard where the reference has two ("Goodbye" for "Good bye") or the other way
 * round is one word said.
 */
export function wordDiff(
  lang: string,
  reference: string,
  actual: string,
  spoken = false,
): WordDiff {
  const ref = words(reference);
  const got = words(actual);
  const eq = (i: number, j: number) =>
    spoken
      ? heard(lang, ref[i] as string) === heard(lang, got[j] ?? "")
      : wordMatches(lang, ref, i, got[j] ?? "", { strip: bare });
  // Words joined differently: two of the reference as one heard (2:1), or one as two (1:2).
  const joined = (a: string[], i: number, b: string[], j: number) =>
    spoken &&
    i + 1 < a.length &&
    j < b.length &&
    heard(lang, a[i] as string) + heard(lang, a[i + 1] as string) === heard(lang, b[j] as string);
  const step = (i: number, j: number): [number, number] | undefined =>
    eq(i, j)
      ? [1, 1]
      : joined(ref, i, got, j)
        ? [2, 1]
        : joined(got, j, ref, i)
          ? [1, 2]
          : undefined;

  const lcs: number[][] = Array.from({ length: ref.length + 2 }, () =>
    Array(got.length + 2).fill(0),
  );
  const at = (i: number, j: number) => lcs[i]?.[j] ?? 0;
  for (let i = ref.length - 1; i >= 0; i--) {
    for (let j = got.length - 1; j >= 0; j--) {
      const s = step(i, j);
      (lcs[i] as number[])[j] = s
        ? at(i + s[0], j + s[1]) + 1
        : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const raw: TokenDiff[] = [];
  let i = 0;
  let j = 0;
  while (i < ref.length || j < got.length) {
    const s = i < ref.length && j < got.length ? step(i, j) : undefined;
    if (s) {
      raw.push({
        op: "equal",
        expected: ref.slice(i, i + s[0]).join(" "),
        actual: got.slice(j, j + s[1]).join(" "),
      });
      i += s[0];
      j += s[1];
    } else if (j < got.length && (i >= ref.length || at(i, j + 1) >= at(i + 1, j))) {
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
  // Words joined differently count once on each side.
  const count = (side: "expected" | "actual", all: string[]) =>
    all.length -
    diff.reduce((n, d) => n + (d.op === "equal" ? (d[side] ?? "").split(" ").length - 1 : 0), 0);
  const matched = diff.filter((d) => d.op === "equal").length;
  const longest = Math.max(count("expected", ref), count("actual", got));
  return { diff, score: longest ? matched / longest : 1 };
}
