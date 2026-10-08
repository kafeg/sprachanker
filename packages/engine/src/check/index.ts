// Checking an answer to one item (04, "Checking"). Matching is by ids; options with identical
// content (same text or same picture) are interchangeable.
import {
  correctOptions,
  DictationAnswer,
  type Exercise,
  GapChoiceAnswer,
  GapTextAnswer,
  MatchAnswer,
  MultiChoiceAnswer,
  type Option,
  OrderAnswer,
  type Outcome,
  RespondAnswer,
  SingleChoiceAnswer,
  SpeechRepeatAnswer,
  SpeechSelfrateAnswer,
} from "@sprachanker/schema";
import { type WordDiff, wordDiff } from "../text/diff.ts";
import { endsSentence, isEmptyGap, sameText, tokens } from "../text/normalise.ts";
import { isChecked } from "./answers.ts";

type Of<T extends Exercise["type"]> = Extract<Exercise, { type: T }>;
type ItemOf<T extends Exercise["type"]> = Of<T>["items"][number];

/** Share of reference words needed for `partial` in dictation and speech. */
const PARTIAL_WORDS = 0.8;

/**
 * What an option shows: its text as written (only whitespace evened out — "Berlin?" and "Berlin."
 * are different options), else its picture, else its id.
 */
const content = (o: Option | undefined) => {
  const text = o?.text?.normalize("NFC").replace(/\s+/g, " ").trim();
  if (text) return `t:${text}`;
  return o?.media?.image ? `i:${o.media.image}` : `id:${o?.id}`;
};
/** Options with identical content are interchangeable (04): ids with equal content compare equal. */
export const sameOption = (options: Option[], a: string | undefined, b: string | undefined) =>
  a === b ||
  (a !== undefined &&
    content(options.find((o) => o.id === a)) === content(options.find((o) => o.id === b)));

const binary = (ok: boolean) => ({ result: ok ? "correct" : "wrong", score: ok ? 1 : 0 }) as const;
const graded = (score: number, partialFrom = 0) =>
  ({
    result: score >= 1 ? "correct" : score > partialFrom && score > 0 ? "partial" : "wrong",
    score: Math.max(0, Math.min(1, score)),
  }) as const;

/** The reference the answer is closest to: an exact one first, then the best score. */
function bestDiff(lang: string, references: string[], actual: string, ignoreCase: boolean) {
  const exact = (d: WordDiff) => d.diff.every((x) => x.op === "equal");
  const better = (a: WordDiff, b: WordDiff) =>
    exact(a) !== exact(b) ? exact(b) : b.score > a.score;
  return references
    .map((r) => wordDiff(lang, r, actual, ignoreCase))
    .reduce((a, b) => (better(a, b) ? b : a));
}

function textOutcome(lang: string, references: string[], actual: string, ignoreCase: boolean) {
  const { diff, score } = bestDiff(lang, references, actual, ignoreCase);
  const exact = diff.every((d) => d.op === "equal");
  return { ...(exact ? binary(true) : graded(Math.min(score, 0.99), PARTIAL_WORDS - 0.001)), diff };
}

/** How a spoken phrase went (08): every word heard ("correct"), most of them — at least 80%,
 *  "partial" — or too few ("wrong"). Shown on a recorded speaking item, which counts in no score. */
export type SpokenVerdict = "correct" | "partial" | "wrong";

/** What was heard against the phrase to say: the words matched and missed, and the verdict. */
export function spokenCheck(lang: string, reference: string, transcript: string) {
  const { diff, result } = textOutcome(lang, [reference], transcript, true);
  return { diff, verdict: result as SpokenVerdict };
}

/** Whether `words` contains `phrase` as whole words in a row (case aside). */
function saysPhrase(lang: string, words: string[], phrase: string) {
  const want = tokens(phrase).map((w) => w.toLocaleLowerCase(lang));
  if (!want.length) return false;
  return words.some((_, i) => want.every((w, k) => words[i + k] === w));
}

function rubric(item: ItemOf<"respond">, text: string, lang: string) {
  const required = item.rubric?.required ?? [];
  if (!required.length) return { result: "unscored", score: 0 } as const;
  // Whole words: "ein" is not in "Nein".
  const said = tokens(text).map((w) => w.replace(/[\p{P}]+$/u, "").toLocaleLowerCase(lang));
  const met = required.filter((g) => g.anyOf.some((v) => saysPhrase(lang, said, v)));
  return binary(met.length === required.length);
}

/** Whether a gap starts a sentence: nothing but empty text before it, or a sentence's end. */
function gapStartsSentence(segments: ItemOf<"gap_text">["segments"], gap: string) {
  const at = segments.findIndex((s) => typeof s !== "string" && s.gap === gap);
  for (let i = at - 1; i >= 0; i--) {
    const s = segments[i];
    if (typeof s !== "string") return false;
    if (s.trim()) return endsSentence(s);
  }
  return true;
}

/** Per-part marks and the item's outcome: right only when every part is. */
const byParts = (parts: Record<string, boolean>) => ({
  ...binary(Object.values(parts).every(Boolean)),
  parts,
});

/** Whether an item is scored: every item of a checked exercise (`isChecked`) the checker can mark
 *  right or wrong — all but free answers without a rubric. */
export function itemScored(exercise: Exercise, index: number): boolean {
  if (!isChecked(exercise.type)) return false;
  if (exercise.type === "respond")
    return !!(exercise.items[index] as ItemOf<"respond"> | undefined)?.rubric?.required?.length;
  return true;
}

/**
 * Outcome of `answer` for item `index` of `exercise`. `lang` is the target language (case rules).
 * Throws on an answer of the wrong shape.
 */
export function checkItem(
  exercise: Exercise,
  index: number,
  answer: unknown,
  lang: string,
): Outcome {
  const base = { ruleIds: exercise.ruleIds, lexemes: [] };
  const item = exercise.items[index];
  if (!item) throw new Error(`${exercise.key} has no item ${index + 1}`);
  switch (exercise.type) {
    case "single_choice": {
      const it = item as ItemOf<"single_choice">;
      const { optionId } = SingleChoiceAnswer.parse(answer);
      return { ...base, ...binary(sameOption(it.options, optionId, it.answer.optionIds[0])) };
    }
    case "multi_choice": {
      const it = item as ItemOf<"multi_choice">;
      const chosen = new Set(MultiChoiceAnswer.parse(answer).optionIds);
      const want = new Set(it.answer.optionIds);
      const hits = [...chosen].filter((id) => want.has(id)).length;
      const wrong = chosen.size - hits;
      return {
        ...base,
        ...(hits === want.size && !wrong ? binary(true) : graded((hits - wrong) / want.size)),
      };
    }
    case "match": {
      const it = item as ItemOf<"match">;
      const chosen = new Map(MatchAnswer.parse(answer).pairs);
      // Left entries with the same content are interchangeable too ("sie" twice): within such a
      // group, the right sides chosen must be the ones wanted, in any order.
      const group = (l: string) => content(it.left.find((o) => o.id === l));
      const rightOf = (r: string | undefined) => content(it.right.find((o) => o.id === r));
      const groupOk = new Map<string, boolean>();
      for (const g of new Set(it.answer.pairs.map(([l]) => group(l)))) {
        const pairs = it.answer.pairs.filter(([l]) => group(l) === g);
        const wanted = pairs.map(([, r]) => rightOf(r)).sort();
        const given = pairs.map(([l]) => rightOf(chosen.get(l))).sort();
        groupOk.set(
          g,
          wanted.every((w, i) => w === given[i]),
        );
      }
      const parts = Object.fromEntries(
        it.answer.pairs.map(([l, r]) => [
          l,
          !!groupOk.get(group(l)) || sameOption(it.right, chosen.get(l), r),
        ]),
      );
      return { ...base, ...byParts(parts) };
    }
    case "order": {
      const it = item as ItemOf<"order">;
      const got = OrderAnswer.parse(answer).sequence;
      const want = it.answer.sequence;
      let prefix = 0;
      while (prefix < want.length && sameOption(it.parts, got[prefix], want[prefix])) prefix++;
      const ok = prefix === want.length && got.length === want.length;
      // Parts beyond the sequence cost as missing ones do.
      return {
        ...base,
        ...(ok ? binary(true) : graded(prefix / Math.max(want.length, got.length))),
      };
    }
    case "gap_choice": {
      const it = item as ItemOf<"gap_choice">;
      const got = GapChoiceAnswer.parse(answer);
      const parts = Object.fromEntries(
        Object.entries(it.answer).map(([gap, want]) => [
          gap,
          correctOptions(want).some((w) => sameOption(it.gaps[gap]?.options ?? [], got[gap], w)),
        ]),
      );
      return { ...base, ...byParts(parts) };
    }
    case "gap_text": {
      const it = item as ItemOf<"gap_text">;
      const got = GapTextAnswer.parse(answer);
      // "" is accepted where nothing belongs; then an empty or dash answer is right. A gap in
      // mid-sentence keeps German's case rule for its first word ("Wie heißen ___?" → "Sie").
      const parts = Object.fromEntries(
        Object.entries(it.answer).map(([gap, { accepted }]) => {
          const starts = gapStartsSentence(it.segments, gap);
          return [
            gap,
            accepted.some((a) =>
              a === "" ? isEmptyGap(got[gap] ?? "") : sameText(lang, a, got[gap] ?? "", starts),
            ),
          ];
        }),
      );
      return { ...base, ...byParts(parts) };
    }
    case "dictation": {
      const it = item as ItemOf<"dictation">;
      return {
        ...base,
        ...textOutcome(lang, it.answer.accepted, DictationAnswer.parse(answer).text, false),
      };
    }
    case "speech_repeat": {
      const it = item as ItemOf<"speech_repeat">;
      const { speech } = SpeechRepeatAnswer.parse(answer);
      return { ...base, ...textOutcome(lang, [it.text], speech.transcript, true) };
    }
    case "respond": {
      const it = item as ItemOf<"respond">;
      const { text, speech } = RespondAnswer.parse(answer);
      return { ...base, ...rubric(it, text || speech?.transcript || "", lang), needsLlm: true };
    }
    case "speech_selfrate": {
      // Recorded and, with recognition, heard: the words compared, still in no score (08).
      const it = item as ItemOf<"speech_selfrate">;
      const { transcript } = SpeechSelfrateAnswer.parse(answer);
      const heard =
        it.text && transcript !== undefined ? spokenCheck(lang, it.text, transcript) : undefined;
      return { ...base, result: "unscored", score: 0, ...(heard && { diff: heard.diff }) };
    }
    case "scene":
    case "unknown":
      return { ...base, result: "unscored", score: 0 };
  }
}
