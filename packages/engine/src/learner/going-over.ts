// Going over mistakes (04, "AI practice in courses"): a pass's mistakes — its items answered wrong at
// the first attempt, and its Understanding questions answered wrong — as their wrong parts only (a
// gap, a pair, the option chosen, the order, the words written or said wrong: what was given, what is
// right, the words around it), grouped by type — the item type new items will be set of, and what
// went wrong (an ending, another word, the spelling…) —, the commonest types first. Answers said
// aloud and Understanding's questions are listed only: no new items are set of them.
import {
  correctOptions,
  type Exercise,
  findExercise,
  GapChoiceAnswer,
  GapTextAnswer,
  type ItemOf,
  joinParts,
  type Lesson,
  type LocaleExercise,
  type LocaleLesson,
  MatchAnswer,
  type MistakeItemType,
  type MistakeKind,
  MultiChoiceAnswer,
  type Option,
  OrderAnswer,
  partsAreSentences,
  SingleChoiceAnswer,
  SpeechSelfrateAnswer,
  type TokenDiff,
  type TypedEvent,
  type WrongPart,
} from "@sprachanker/schema";
import { checkItem } from "../check/index.ts";
import { questionPhase, understandingExercise } from "../check/understanding.ts";
import { wordDiff } from "../text/diff.ts";
import { mistakesOf } from "./mistakes.ts";

/** A mistake to go over: the item as the pass showed it, the first answer to it. */
export interface MistakeToGoOver {
  itemKey: string;
  exercise: Exercise;
  locale?: LocaleExercise | null;
  index: number;
  answer: unknown;
  /** An answer said aloud: the model's correction of what was heard. */
  corrected?: string;
  /** An Understanding question: whether its text was heard (else read), the text's lines. */
  text?: { heard: boolean; lines: string[] };
}

/** The types of mistakes gone over with new items, of how many wrong parts each at most. */
export const GOING_OVER = { groups: 3, parts: 6 } as const;

/** The closed type new items of a mistake are set of: the exercise's own, or the nearest (a multiple
 *  choice → one answer, letters ordered or a dictation → a gap typed); none for one listed only (an
 *  answer said aloud, an Understanding question). */
function newItemsOf(m: MistakeToGoOver): MistakeItemType | undefined {
  if (m.text) return undefined;
  const { exercise } = m;
  switch (exercise.type) {
    case "single_choice":
    case "multi_choice":
      return "single_choice";
    case "order":
      return (exercise.items[m.index] as ItemOf<"order"> | undefined)?.join === "none"
        ? "gap_text"
        : "order";
    case "match":
    case "gap_choice":
    case "gap_text":
      return exercise.type;
    case "dictation":
      return "gap_text";
    default:
      return undefined;
  }
}

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

/** Course HTML as one line of text (an exercise's instruction). */
const plainText = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** What a language writes two ways and is the same word (data, per language): German's ß as ss. */
const SAME_SPELLING: Record<string, Array<[RegExp, string]>> = {
  de: [[/ß/g, "ss"]],
};

/** A word with the language's spellings of one sound made one. */
const spelt = (w: string, lang: string) =>
  (SAME_SPELLING[lang] ?? []).reduce((s, [from, to]) => s.replace(from, to), w);

/** Without accents, umlauts and other marks. */
const unmarked = (w: string) => w.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");

/** Letters to change, add, drop or swap with the next to make one word the other. */
function edits(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  const at = (i: number, j: number) => d[i]?.[j] ?? 0;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      let best = Math.min(
        at(i - 1, j) + 1,
        at(i, j - 1) + 1,
        at(i - 1, j - 1) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        best = Math.min(best, at(i - 2, j - 2) + 1);
      (d[i] as number[])[j] = best;
    }
  return at(a.length, b.length);
}

/**
 * What a word written in place of another is, in the language learnt (its case rules: Turkish I is
 * ı): the same word misspelt (only its case, a spelling of the same sound — German's ss for ß —, or a
 * letter or two off inside it), another ending of it (the same start), or another word. A difference
 * only in accents or umlauts is another word: Mutter and Mütter, wurde and würde, schon and schön,
 * si and sí differ in meaning or form, never a slip.
 */
export function slipOf(given: string, right: string, lang: string): "spelling" | "ending" | "word" {
  const g = given.trim().normalize("NFC").toLocaleLowerCase(lang);
  const r = right.trim().normalize("NFC").toLocaleLowerCase(lang);
  if (!g || !r || /\s/.test(g) || /\s/.test(r)) return "word";
  if (spelt(g, lang) === spelt(r, lang)) return "spelling";
  if (unmarked(g) === unmarked(r)) return "word";
  let p = 0;
  while (p < g.length && p < r.length && g[p] === r[p]) p++;
  if (p >= 2 && p >= Math.max(g.length, r.length) - 3) return "ending";
  return edits(g, r) <= (Math.max(g.length, r.length) >= 8 ? 2 : 1) ? "spelling" : "word";
}

/** The line of a text the right answer is in (case aside), if one line has it. */
const lineWith = (lines: string[], rights: string[], lang: string) =>
  lines.find((l) =>
    rights.some(
      (r) => r.trim() && l.toLocaleLowerCase(lang).includes(r.trim().toLocaleLowerCase(lang)),
    ),
  );

/** The wrong parts of one mistake, only them; none when its answer does not read as its type's, or
 *  when what it shows has no words to name it by (a picture without a description). */
export function wrongParts(m: MistakeToGoOver, lang: string): WrongPart[] {
  const parts = itemParts(m, lang);
  if (!m.text) return parts;
  const what: MistakeKind = m.text.heard ? "misheard" : "misread";
  const question = m.exercise.items[m.index]?.prompt;
  return parts.map((p) => {
    const line = lineWith(m.text?.lines ?? [], p.right.split(" / "), lang);
    return {
      ...p,
      what,
      ...(question ? { context: firstWords(question) } : {}),
      ...(line ? { line } : {}),
    };
  });
}

function itemParts(m: MistakeToGoOver, lang: string): WrongPart[] {
  const { exercise, index, itemKey } = m;
  const item = exercise.items[index];
  if (!item) return [];
  const loc = m.locale?.items[`#${index + 1}`];
  // An option by its words: its text, else the edition's text or description of it.
  const label = (o: Option | undefined) =>
    o && (o.text ?? loc?.options?.[o.id] ?? loc?.alt?.[o.id]);
  const read = <T>(schema: { safeParse(v: unknown): { success: boolean; data?: T } }) =>
    schema.safeParse(m.answer).data;
  const part = (what: MistakeKind, given: string, right: string, context?: string): WrongPart => ({
    itemKey,
    what,
    given,
    right,
    ...(context && { context }),
  });
  let checked: ReturnType<typeof checkItem>;
  try {
    checked = checkItem(exercise, index, m.answer, lang);
  } catch {
    return [];
  }
  const parts = checked.parts;
  const instruction = m.locale?.instructionHtml && plainText(m.locale.instructionHtml);
  const prompt = item.prompt ?? loc?.prompt ?? (instruction || undefined);
  const asked = prompt ? firstWords(prompt) : undefined;
  /** Each word written or said wrong, with the words around it (the others as they should be). */
  const words = (diff: TokenDiff[], kind: (given: string, right: string) => MistakeKind) =>
    diff.flatMap((d, i) => {
      if (d.op === "equal") return [];
      const text = diff
        .map((x, k) => (k === i ? GAP : x.op === "extra" ? "" : (x.expected ?? "")))
        .filter(Boolean)
        .join(" ");
      const given = d.actual ?? "";
      const right = d.expected ?? "";
      return [part(kind(given, right), given, right || "—", around(text))];
    });

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
        // Options without words (pictures undescribed): nothing to name the part by.
        const unnamed = chosen?.[s.gap] !== undefined && option(s.gap, chosen[s.gap]) === undefined;
        if (exercise.type === "gap_choice" && (!right.length || unnamed)) return [];
        const text = it.segments
          .map((x) =>
            typeof x === "string" ? x : x.gap === s.gap ? GAP : (rights(x.gap)[0] ?? "…"),
          )
          .join("");
        const shown = right.filter(Boolean).join(" / ") || "—";
        const g = given(s.gap);
        return [part(slipOf(g, right[0] ?? "", lang), g, shown, around(text))];
      });
    }
    case "match": {
      const it = item as ItemOf<"match">;
      const pairs = new Map(read(MatchAnswer)?.pairs ?? []);
      const right = (id: string | undefined) => label(it.right.find((o) => o.id === id));
      return it.answer.pairs.flatMap(([l, r]) => {
        const left = label(it.left.find((o) => o.id === l));
        const want = right(r);
        const got = pairs.has(l) ? right(pairs.get(l)) : "";
        return parts?.[l] === false && left && want && got !== undefined
          ? [part("pair", got, want, left)]
          : [];
      });
    }
    case "order": {
      const it = item as ItemOf<"order">;
      const texts = (ids: string[]) => ids.map((id) => label(it.parts.find((p) => p.id === id)));
      const given = texts(read(OrderAnswer)?.sequence ?? []);
      const right = texts(it.answer.sequence);
      if ([...given, ...right].some((t) => t === undefined)) return [];
      const known = (t: Array<string | undefined>) => t as string[];
      if (it.join === "none")
        return [part("spelling", joinParts(given, "none"), joinParts(right, "none"), asked)];
      // Sentences of a text: only the places taken by another sentence.
      if (partsAreSentences(right))
        return known(right).flatMap((r, i) =>
          given[i] !== r ? [part("sentence_order", given[i] ?? "", r)] : [],
        );
      return [part("order", joinParts(given, it.join), joinParts(right, it.join))];
    }
    case "single_choice":
    case "multi_choice": {
      const it = item as ItemOf<"single_choice">;
      const texts = (ids: string[]) => ids.map((id) => label(it.options.find((o) => o.id === id)));
      const chosen = texts(
        (exercise.type === "single_choice"
          ? [read(SingleChoiceAnswer)?.optionId ?? ""]
          : (read(MultiChoiceAnswer)?.optionIds ?? [])
        ).filter(Boolean),
      );
      const right = texts(it.answer.optionIds);
      if ([...chosen, ...right].some((t) => t === undefined)) return [];
      return [part("choice", chosen.join(", "), right.join(", "), asked)];
    }
    case "dictation":
      return words(checked.diff ?? [], (given, right) => slipOf(given, right, lang));
    case "speech_repeat":
      return words(checked.diff ?? [], () => "spoken");
    case "speech_selfrate": {
      const heard = read(SpeechSelfrateAnswer)?.transcript;
      if (heard === undefined || m.corrected === undefined) return [];
      return words(wordDiff(lang, m.corrected, heard, true).diff, () => "spoken");
    }
    default:
      return [];
  }
}

/** A type of mistakes: the item type new items are set of (none: listed only), what went wrong,
 *  its wrong parts. */
export interface MistakeGroupDraft {
  type?: MistakeItemType;
  what: MistakeKind;
  mistakes: WrongPart[];
}

/** Grammar before the rest when types are chosen: a form, a word, its spelling, the order of words
 *  or sentences; then pairs; the options chosen last (in courses mostly what was understood of a
 *  film or a text, no grammar point). */
const rank = (what: MistakeKind) => (what === "choice" ? 2 : what === "pair" ? 1 : 0);

/**
 * A pass's mistakes by type: those new items are set of — grammar first (`rank`), the commonest first
 * within it (in the order met where as common) —, at most `GOING_OVER.groups`; then those listed only — said aloud, then Understanding's
 * questions in one group (comprehension), last —; each of at most `GOING_OVER.parts` wrong parts.
 * `more`: the wrong parts left out.
 */
export function mistakeGroups(
  list: MistakeToGoOver[],
  lang: string,
): { groups: MistakeGroupDraft[]; more: number } {
  const groups = new Map<string, MistakeGroupDraft>();
  let all = 0;
  for (const m of list) {
    const type = newItemsOf(m);
    for (const p of wrongParts(m, lang)) {
      const what = m.text ? "comprehension" : p.what;
      const key = `${type ?? ""}:${what}`;
      const group = groups.get(key) ?? { ...(type && { type }), what, mistakes: [] };
      group.mistakes.push(p);
      groups.set(key, group);
      all++;
    }
  }
  const drafts = [...groups.values()];
  const kept = [
    ...drafts
      .filter((g) => g.type)
      .sort((a, b) => rank(a.what) - rank(b.what) || b.mistakes.length - a.mistakes.length)
      .slice(0, GOING_OVER.groups),
    ...drafts.filter((g) => !g.type && g.what !== "comprehension"),
    ...drafts.filter((g) => g.what === "comprehension"),
  ].map((g) => ({ ...g, mistakes: g.mistakes.slice(0, GOING_OVER.parts) }));
  return { groups: kept, more: all - kept.reduce((n, g) => n + g.mistakes.length, 0) };
}

/** The Understanding questions of a run answered wrong (or partly), as mistakes to go over: each the
 *  item of its kind, keyed by its text's verdict and its number, with its text. */
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
    const text = texts.get(e.payload.verdict);
    const q = text?.questions[e.payload.question];
    if (!text || !q) return [];
    return [
      {
        itemKey: `${e.payload.verdict}#${e.payload.question + 1}`,
        exercise: understandingExercise(q, e.payload.verdict),
        index: 0,
        answer: e.payload.answer,
        text: {
          heard: questionPhase(text, q) === "listening",
          lines: text.lines.map((l) => l.text),
        },
      },
    ];
  });
}

/** A run's mistakes to go over in the lesson: its items answered wrong at first — of exercises still
 *  in the lesson, in its order, with the edition's texts of them —, then its Understanding questions
 *  answered wrong. */
export function mistakesToGoOver(
  events: TypedEvent[],
  lesson: Lesson,
  locale?: LocaleLesson | null,
): MistakeToGoOver[] {
  const page = (key: string) => lesson.pages.findIndex((p) => p.exercise.key === key);
  const items = mistakesOf([{ events }])
    .sort((a, b) => page(a.exerciseKey) - page(b.exerciseKey) || a.index - b.index)
    .flatMap((m): MistakeToGoOver[] => {
      const exercise = findExercise(lesson, m.exerciseKey);
      return exercise
        ? [
            {
              itemKey: m.itemKey,
              exercise,
              locale: locale?.exercises[exercise.key],
              index: m.index,
              answer: m.answer,
              ...(m.corrected !== undefined && { corrected: m.corrected }),
            },
          ]
        : [];
    });
  return [...items, ...understandingMistakes(events)];
}

/** Whether a run has a mistake to go over in the lesson: one with a wrong part to show — its
 *  exercise still there, of a type gone over or listed, its answer read. The plan's step and the
 *  server's review read it alike. */
export const hasMistakesToGoOver = (events: TypedEvent[], lesson: Lesson, lang: string) =>
  mistakesToGoOver(events, lesson).some((m) => wrongParts(m, lang).length > 0);
