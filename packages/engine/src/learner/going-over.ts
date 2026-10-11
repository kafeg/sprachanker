// Going over mistakes (04, "AI practice in courses"): a pass's mistakes — its items answered wrong at
// the first attempt, and its Understanding questions answered wrong — as their wrong parts only (a
// gap, a pair, the option chosen, the order, words written or said: what was given, what is right,
// the words around it), grouped by type — the item type new items will be set of, and what went
// wrong (an ending, another word, the spelling…) —, the commonest types first.
import {
  correctOptions,
  DictationAnswer,
  type Exercise,
  GapChoiceAnswer,
  GapTextAnswer,
  type ItemOf,
  joinParts,
  type LocaleExercise,
  MatchAnswer,
  type MistakeItemType,
  type MistakeKind,
  MultiChoiceAnswer,
  type Option,
  OrderAnswer,
  SingleChoiceAnswer,
  SpeechRepeatAnswer,
  SpeechSelfrateAnswer,
  type TypedEvent,
  type WrongPart,
} from "@sprachanker/schema";
import { checkItem } from "../check/index.ts";
import { understandingExercise } from "../check/understanding.ts";

/** A mistake to go over: the item as the pass showed it, the first answer to it. */
export interface MistakeToGoOver {
  itemKey: string;
  exercise: Exercise;
  locale?: LocaleExercise | null;
  index: number;
  answer: unknown;
  /** An answer said aloud: the model's correction of what was heard. */
  corrected?: string;
}

/** The types of mistakes gone over, of how many wrong parts each at most. */
export const GOING_OVER = { groups: 3, parts: 6 } as const;

/** The closed type new items of an exercise's mistakes are set of. */
const ITEM_TYPE: Partial<Record<Exercise["type"], MistakeItemType>> = {
  single_choice: "single_choice",
  multi_choice: "single_choice",
  match: "match",
  order: "order",
  gap_choice: "gap_choice",
  gap_text: "gap_text",
  dictation: "gap_text",
  speech_repeat: "gap_text",
  speech_selfrate: "gap_text",
};

/** Words kept on each side of a gap in its context. */
const AROUND = 6;
const GAP = "[_]";

/** The words around a gap, whole words only, "…" where cut. */
function around(text: string) {
  const words = text.split(/\s+/).filter(Boolean);
  const at = words.findIndex((w) => w.includes(GAP));
  const from = Math.max(0, at - AROUND);
  const to = Math.min(words.length, at + AROUND + 1);
  return [from > 0 && "…", ...words.slice(from, to), to < words.length && "…"]
    .filter(Boolean)
    .join(" ");
}

/** A sentence cut to its first words, whole words only. */
const firstWords = (text: string, n = 16) => {
  const words = text.split(/\s+/).filter(Boolean);
  return words.length > n ? `${words.slice(0, n).join(" ")} …` : words.join(" ");
};

/** Without accents and with ß as ss, lower case: what a slip of spelling leaves the same. */
const plain = (w: string) =>
  w.normalize("NFD").replace(/\p{M}/gu, "").replace(/ß/g, "ss").toLocaleLowerCase();

/** What a word written in place of another is: the same word misspelt, another ending of it, or
 *  another word. */
export function slipOf(given: string, right: string): "spelling" | "ending" | "word" {
  const g = given.trim().toLocaleLowerCase();
  const r = right.trim().toLocaleLowerCase();
  if (!g || !r || /\s/.test(g) || /\s/.test(r)) return "word";
  if (plain(g) === plain(r)) return "spelling";
  let p = 0;
  while (p < g.length && p < r.length && g[p] === r[p]) p++;
  return p >= 2 && p >= Math.max(g.length, r.length) - 3 ? "ending" : "word";
}

/** The wrong parts of one mistake, only them; none when its answer does not read as its type's. */
export function wrongParts(m: MistakeToGoOver, lang: string): WrongPart[] {
  const { exercise, index, itemKey } = m;
  const item = exercise.items[index];
  if (!item) return [];
  const loc = m.locale?.items[`#${index + 1}`];
  const label = (o: Option | undefined) =>
    o?.text ?? (o && (loc?.options?.[o.id] ?? loc?.alt?.[o.id])) ?? `[${o?.id ?? "?"}]`;
  const read = <T>(schema: { safeParse(v: unknown): { success: boolean; data?: T } }) =>
    schema.safeParse(m.answer).data;
  const part = (what: MistakeKind, given: string, right: string, context?: string): WrongPart => ({
    itemKey,
    what,
    given,
    right,
    ...(context && { context }),
  });
  let parts: Record<string, boolean> | undefined;
  try {
    parts = checkItem(exercise, index, m.answer, lang).parts;
  } catch {
    return [];
  }
  const prompt = item.prompt ? firstWords(item.prompt) : undefined;

  switch (exercise.type) {
    case "gap_text":
    case "gap_choice": {
      const it = item as ItemOf<"gap_text"> & Partial<ItemOf<"gap_choice">>;
      const typed = exercise.type === "gap_text" ? read(GapTextAnswer) : undefined;
      const chosen = exercise.type === "gap_choice" ? read(GapChoiceAnswer) : undefined;
      const option = (gap: string, id: string | undefined) =>
        id === undefined ? undefined : label(it.gaps?.[gap]?.options.find((o) => o.id === id));
      const rights = (gap: string): string[] =>
        exercise.type === "gap_text"
          ? ((it.answer as ItemOf<"gap_text">["answer"])[gap]?.accepted ?? [])
          : correctOptions((it.answer as ItemOf<"gap_choice">["answer"])[gap]).flatMap(
              (id) => option(gap, id) ?? [],
            );
      const given = (gap: string) =>
        (typed ? typed[gap]?.trim() : option(gap, chosen?.[gap])) ?? "";
      return it.segments.flatMap((s) => {
        if (typeof s === "string" || parts?.[s.gap] !== false) return [];
        const right = rights(s.gap);
        const text = it.segments
          .map((x) =>
            typeof x === "string" ? x : x.gap === s.gap ? GAP : (rights(x.gap)[0] ?? "…"),
          )
          .join("");
        const shown = right.filter(Boolean).join(" / ") || "—";
        return [part(slipOf(given(s.gap), right[0] ?? ""), given(s.gap), shown, around(text))];
      });
    }
    case "match": {
      const it = item as ItemOf<"match">;
      const pairs = new Map(read(MatchAnswer)?.pairs ?? []);
      const right = (id: string | undefined) => label(it.right.find((o) => o.id === id));
      return it.answer.pairs.flatMap(([l, r]) =>
        parts?.[l] === false
          ? [
              part(
                "pair",
                pairs.has(l) ? right(pairs.get(l)) : "",
                right(r),
                label(it.left.find((o) => o.id === l)),
              ),
            ]
          : [],
      );
    }
    case "order": {
      const it = item as ItemOf<"order">;
      const joined = (ids: string[]) =>
        joinParts(
          ids.map((id) => label(it.parts.find((p) => p.id === id))),
          it.join,
        );
      return [part("order", joined(read(OrderAnswer)?.sequence ?? []), joined(it.answer.sequence))];
    }
    case "single_choice":
    case "multi_choice": {
      const it = item as ItemOf<"single_choice">;
      const texts = (ids: string[]) =>
        ids.map((id) => label(it.options.find((o) => o.id === id))).join(", ");
      const chosen =
        exercise.type === "single_choice"
          ? [read(SingleChoiceAnswer)?.optionId ?? ""]
          : (read(MultiChoiceAnswer)?.optionIds ?? []);
      return [part("choice", texts(chosen.filter(Boolean)), texts(it.answer.optionIds), prompt)];
    }
    case "dictation": {
      const it = item as ItemOf<"dictation">;
      return [part("spelling", read(DictationAnswer)?.text ?? "", it.answer.accepted[0] ?? "")];
    }
    case "speech_repeat": {
      const it = item as ItemOf<"speech_repeat">;
      return [part("spoken", read(SpeechRepeatAnswer)?.speech.transcript ?? "", it.text)];
    }
    case "speech_selfrate": {
      const heard = read(SpeechSelfrateAnswer)?.transcript;
      return heard !== undefined && m.corrected !== undefined
        ? [part("spoken", heard, m.corrected, prompt)]
        : [];
    }
    default:
      return [];
  }
}

/** A type of mistakes: the item type new items are set of, what went wrong, its wrong parts. */
export interface MistakeGroupDraft {
  type: MistakeItemType;
  what: MistakeKind;
  mistakes: WrongPart[];
}

/** A pass's mistakes by type, the commonest first (in the order met where as common), at most
 *  `GOING_OVER.groups` of at most `GOING_OVER.parts` wrong parts each. */
export function mistakeGroups(list: MistakeToGoOver[], lang: string): MistakeGroupDraft[] {
  const groups = new Map<string, MistakeGroupDraft>();
  for (const m of list) {
    const type = ITEM_TYPE[m.exercise.type];
    if (!type) continue;
    for (const p of wrongParts(m, lang)) {
      const key = `${type}:${p.what}`;
      const group = groups.get(key) ?? { type, what: p.what, mistakes: [] };
      group.mistakes.push(p);
      groups.set(key, group);
    }
  }
  return [...groups.values()]
    .sort((a, b) => b.mistakes.length - a.mistakes.length)
    .slice(0, GOING_OVER.groups)
    .map((g) => ({ ...g, mistakes: g.mistakes.slice(0, GOING_OVER.parts) }));
}

/** The Understanding questions of a run answered wrong (or partly), as mistakes to go over: each the
 *  item of its kind, keyed by its text's verdict and its number. */
export function understandingMistakes(events: TypedEvent[]): MistakeToGoOver[] {
  const texts = new Map(
    events.flatMap((e) =>
      e.type === "llm_verdict" && e.payload.task === "understanding"
        ? [[e.id, e.payload.result] as const]
        : [],
    ),
  );
  return events.flatMap((e) => {
    if (e.type !== "practice_answered" || e.payload.outcome.result === "correct") return [];
    const q = texts.get(e.payload.verdict)?.questions[e.payload.question];
    if (!q) return [];
    const itemKey = `${e.payload.verdict}#${e.payload.question + 1}`;
    return [
      {
        itemKey,
        exercise: understandingExercise(q, e.payload.verdict),
        index: 0,
        answer: e.payload.answer,
      },
    ];
  });
}
