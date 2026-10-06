// Checking an answer to one item (04, "Checking"). Matching is by ids; options with identical
// content (same text or same picture) are interchangeable.
import {
  correctOptions,
  DictationAnswer,
  type Exercise,
  GapChoiceAnswer,
  GapTextAnswer,
  isEmptyGap,
  MatchAnswer,
  MultiChoiceAnswer,
  type Option,
  OrderAnswer,
  type Outcome,
  RespondAnswer,
  SingleChoiceAnswer,
  SpeechRepeatAnswer,
} from "@sprachanker/schema";
import { wordDiff } from "../text/diff.ts";
import { normalise, sameText } from "../text/normalise.ts";

type Of<T extends Exercise["type"]> = Extract<Exercise, { type: T }>;
type ItemOf<T extends Exercise["type"]> = Of<T>["items"][number];

/** Share of reference words needed for `partial` in dictation and speech. */
const PARTIAL_WORDS = 0.8;

const content = (o: Option | undefined) =>
  o?.text !== undefined
    ? `t:${normalise(o.text)}`
    : o?.media?.image
      ? `i:${o.media.image}`
      : `id:${o?.id}`;
const sameOption = (options: Option[], a: string | undefined, b: string | undefined) =>
  a === b ||
  (a !== undefined &&
    content(options.find((o) => o.id === a)) === content(options.find((o) => o.id === b)));

const binary = (ok: boolean) => ({ result: ok ? "correct" : "wrong", score: ok ? 1 : 0 }) as const;
const graded = (score: number, partialFrom = 0) =>
  ({
    result: score >= 1 ? "correct" : score > partialFrom && score > 0 ? "partial" : "wrong",
    score: Math.max(0, Math.min(1, score)),
  }) as const;

function bestDiff(lang: string, references: string[], actual: string, ignoreCase: boolean) {
  return references
    .map((r) => wordDiff(lang, r, actual, ignoreCase))
    .reduce((a, b) => (b.score > a.score ? b : a));
}

function textOutcome(lang: string, references: string[], actual: string, ignoreCase: boolean) {
  const { diff, score } = bestDiff(lang, references, actual, ignoreCase);
  const exact = diff.every((d) => d.op === "equal");
  return { ...(exact ? binary(true) : graded(Math.min(score, 0.99), PARTIAL_WORDS - 0.001)), diff };
}

function rubric(item: ItemOf<"respond">, text: string) {
  const required = item.rubric?.required ?? [];
  if (!required.length) return { result: "unscored", score: 0 } as const;
  const said = normalise(text).toLocaleLowerCase();
  const met = required.filter((g) =>
    g.anyOf.some((v) => said.includes(normalise(v).toLocaleLowerCase())),
  );
  return binary(met.length === required.length);
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
      const ok = it.answer.pairs.every(([l, r]) => sameOption(it.right, chosen.get(l), r));
      return { ...base, ...binary(ok) };
    }
    case "order": {
      const it = item as ItemOf<"order">;
      const got = OrderAnswer.parse(answer).sequence;
      const want = it.answer.sequence;
      let prefix = 0;
      while (prefix < want.length && sameOption(it.parts, got[prefix], want[prefix])) prefix++;
      const ok = prefix === want.length && got.length === want.length;
      return { ...base, ...(ok ? binary(true) : graded(prefix / want.length)) };
    }
    case "gap_choice": {
      const it = item as ItemOf<"gap_choice">;
      const got = GapChoiceAnswer.parse(answer);
      const ok = Object.entries(it.answer).every(([gap, want]) =>
        correctOptions(want).some((w) => sameOption(it.gaps[gap]?.options ?? [], got[gap], w)),
      );
      return { ...base, ...binary(ok) };
    }
    case "gap_text": {
      const it = item as ItemOf<"gap_text">;
      const got = GapTextAnswer.parse(answer);
      // "" is accepted where nothing belongs; then an empty or dash answer is right.
      const ok = Object.entries(it.answer).every(([gap, { accepted }]) =>
        accepted.some((a) =>
          a === "" ? isEmptyGap(got[gap] ?? "") : sameText(lang, a, got[gap] ?? ""),
        ),
      );
      return { ...base, ...binary(ok) };
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
      return { ...base, ...rubric(it, text || speech?.transcript || ""), needsLlm: true };
    }
    case "speech_selfrate":
    case "scene":
    case "unknown":
      return { ...base, result: "unscored", score: 0 };
  }
}
