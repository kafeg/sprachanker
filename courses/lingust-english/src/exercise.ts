// A source exercise → one of our types (02). Mechanics, by the answer fields of the page:
//   gaps in English sentences (inputs)      → gap_text   (answers: the key's bold part; "/" = variants)
//   gaps as drop-down lists (selects)       → gap_choice (dropdown; check boxes for commas: "," / "–")
//   Russian sentence + answer field         → respond    (reference: the key's English sentence)
//   English sentence to transform/question  → respond    (prompt in canonical, reference from the key)
//   English sentence to translate           → respond    (answerIn "learner", model in the locale)
//   Question/Answer rows                    → respond    (reference: the answers shown)
//   grid of words with answer fields        → respond    (one item per row, its key line in order)
//   text answer field with a key            → respond    (one item, or one per word with its own answer)
//   players / reading or speaking tasks     → speech_selfrate
// Tasks with no answers at all → Homework (a reference tab); anything else unmappable → unknown.
import type { ExerciseDraft } from "@sprachanker/course-kit";
import {
  CYRILLIC,
  escapeHtml,
  hasCyrillic,
  latinLetters,
  plainText,
  Unmapped,
} from "@sprachanker/course-kit";
import {
  type ExerciseKey,
  itemKey,
  type LocaleItem,
  type MediaPath,
  optionId,
} from "@sprachanker/schema";
import type { KeyEntry, Seg, SourceExercise, Unit } from "./parse/exercise.ts";
import type { Line, Snippet } from "./parse/snippets.ts";
import { flatText, isRussian, withoutIpa, withoutRussianRemarks } from "./text.ts";

/** A task without answers to check ("write a letter"): the lesson's homework, not an exercise. */
export class Homework extends Error {}

export interface Mapped {
  draft: Omit<ExerciseDraft, "key" | "newWords" | "ruleIds">;
  items: Record<string, LocaleItem>;
  /** Items left out (no key entry, answers not matching the gaps), with the reason. */
  skipped: string[];
}

type Media = (url: string | undefined) => MediaPath | undefined;

const para = (text: string) => `<p>${escapeHtml(text)}</p>`;

/** Accepted variants of one answer: "who/that" → both; "(the) car" → also "car" and "the car". */
export function variants(answer: string): string[] {
  const out = new Set<string>();
  for (const v of answer.split("/").map((s) => s.trim())) {
    // "–": nothing belongs there (no article).
    if (/^[-–—]$/.test(v)) out.add("");
    if (!v || /^[-–—]$/.test(v)) continue;
    out.add(v);
    if (/\(.*\)/.test(v)) {
      out.add(v.replace(/\s*\([^)]*\)\s*/g, " ").trim());
      out.add(v.replace(/[()]/g, "").trim());
    }
  }
  return [...out];
}

/** "<strong>comes, does, is</strong>: Ник …" → answers per gap and the translation. */
export function gapKey(entry: KeyEntry, gaps: number): { answers: string[]; translation: string } {
  const first = entry[0] ?? "";
  // The answers are in bold, before the colon that starts the translation; remarks between bold
  // parts ("(можно: more happy)") are not answers.
  const bold =
    /^[\s\S]*?(?:<\/strong>\s*(?:\([+\-–]\)\s*)?:|:\s*<\/strong>)/.exec(first) ??
    /^[\s\S]*<\/strong>/.exec(first);
  if (!bold) throw new Unmapped("key entry without the bold answers");
  const whole = [...bold[0].matchAll(/<strong>([\s\S]*?)<\/strong>/g)]
    .map((m) =>
      plainText(m[1])
        .replace(/[:.,]$/, "")
        .trim(),
    )
    .join(", ");
  // Gaps are separated by commas, gaps of one verb form by "..." ("has ... taken").
  const answers =
    gaps === 1
      ? [whole]
      : [whole.split(/\s*,\s*/), whole.split(/\s*(?:,|\.\.\.|…)\s*/)].find(
          (a) => a.length === gaps,
        );
  if (!answers) throw new Unmapped(`the key's answers do not match the ${gaps} gaps`);
  const translation = plainText(
    [first.slice((bold.index ?? 0) + bold[0].length), ...entry.slice(1)].join(" "),
  ).replace(/^[\s:]+/, "");
  return { answers, translation };
}

/** English lines of a key entry (the model answer) and the Russian ones (a translation). */
function englishKey(entry: KeyEntry): { reference?: string; russian: string[] } {
  const en: string[] = [];
  const ru: string[] = [];
  for (const line of entry.map((l) => plainText(l)).filter(Boolean)) {
    const text = withoutRussianRemarks(line);
    if (isRussian(text) || latinLetters(text) < 2) ru.push(line);
    else en.push(text);
  }
  return { ...(en.length ? { reference: en.join(" ") } : {}), russian: ru };
}

const segText = (segs: Seg[]) =>
  plainText(segs.filter((s): s is string => typeof s === "string").join(""));

const gapsOf = (u: Unit) => u.segs.filter((s) => typeof s !== "string");

/** Segments with gap ids; Russian remarks removed from the text around the gaps. */
function segments(u: Unit): Array<string | { gap: string }> {
  const out: Array<string | { gap: string }> = [];
  let text = "";
  let g = 0;
  const flush = () => {
    const clean = withoutRussianRemarks(plainText(text.replace(/\s+/g, " ")));
    // plainText trims; keep a space next to the gaps.
    const lead = /^\s/.test(text) && out.length ? " " : "";
    const trail = /\s$/.test(text) ? " " : "";
    if (clean) out.push(`${lead}${clean}${trail}`);
    else if (out.length && (lead || trail)) out.push(" ");
    text = "";
  };
  for (const s of u.segs) {
    if (typeof s === "string") text += s;
    else {
      flush();
      out.push({ gap: `g${++g}` });
    }
  }
  flush();
  const first = out[0];
  const last = out.at(-1);
  if (typeof first === "string") out[0] = first.trimStart();
  if (typeof last === "string") out[out.length - 1] = last.trimEnd();
  return out.filter((s) => s !== "");
}

function speechItems(key: ExerciseKey, snippets: Snippet[], media: Media) {
  const items: Array<Record<string, unknown>> = [];
  const locale: Record<string, LocaleItem> = {};
  for (const s of snippets) {
    const text = s.lines.map((l: Line) => l.en).join("\n");
    const audio = media(s.audio);
    if (!text && !audio) continue;
    const n = items.length + 1;
    items.push({
      key: itemKey(key, n),
      ...(audio ? { media: { audio } } : {}),
      ...(text ? { text } : {}),
    });
    const ru = s.lines.flatMap((l) => (l.ru ? [l.ru] : []));
    if (ru.length) locale[`#${n}`] = { hintHtml: `<p>${ru.map(escapeHtml).join("<br>")}</p>` };
  }
  return { items, locale };
}

/** Listen-and-repeat items from players (with their example text). */
export function speechExercise(key: ExerciseKey, snippets: Snippet[], media: Media) {
  const { items, locale } = speechItems(key, snippets, media);
  return items.length ? { items, locale } : undefined;
}

const SPEAKING = /вслух|повтор|произн|прочитайте|назовите|перескаж|посчитайте|скажите|read|repeat/i;

export function mapExercise(key: ExerciseKey, ex: SourceExercise, media: Media): Mapped {
  const units = ex.units.filter((u) => !u.example);
  const skipped: string[] = [];
  const items: Array<Record<string, unknown>> = [];
  const locale: Record<string, LocaleItem> = {};
  const add = (item: Record<string, unknown>, loc: LocaleItem) => {
    const n = items.length + 1;
    items.push({ key: itemKey(key, n), ...item });
    if (Object.keys(loc).length) locale[`#${n}`] = loc;
  };
  const done = (draft: Omit<Mapped["draft"], "items">): Mapped => {
    if (!items.length) throw new Unmapped(skipped[0] ?? "no items");
    return { draft: { ...draft, items } as Mapped["draft"], items: locale, skipped };
  };

  if (units.length) {
    const withGaps = units.filter((u) => gapsOf(u).length);
    if (withGaps.length && withGaps.length !== units.length)
      throw new Unmapped("items with and without gaps");
    if (withGaps.length) {
      const selects = units.flatMap(gapsOf).filter((g) => "options" in g).length;
      const all = units.flatMap(gapsOf).length;
      if (selects && selects !== all) throw new Unmapped("text gaps and drop-down gaps together");
      // An empty choice means "nothing here"; the key writes it as "–".
      const none = units.some((u) => u.key && /<strong>[^<]*–/.test(u.key[0] ?? ""));
      for (const u of units) {
        try {
          if (!u.key) throw new Unmapped("no key entry");
          const gaps = gapsOf(u);
          const commas = gaps.filter((g) => "comma" in g).length;
          const { answers, translation } = gapKey(u.key, gaps.length - commas);
          // "(+)": the clause is set off by commas, "(-)": it is not.
          const sign = /\((\+|-|–)\)/.exec(u.key[0] ?? "")?.[1];
          if (commas && !sign) throw new Unmapped("no comma mark in the key");
          const hint = hasCyrillic(translation) ? { hintHtml: para(translation) } : {};
          const segs = segments(u);
          if (selects) {
            const gapDefs: Record<string, { options: Array<{ id: string; text: string }> }> = {};
            const answer: Record<string, string | string[]> = {};
            let a = 0;
            gaps.forEach((g, i) => {
              const comma = "comma" in g;
              const opts = comma
                ? (g as { options: string[] }).options
                : [...(g as { options: string[] }).options, ...(none ? ["–"] : [])];
              const options = opts.map((text, j) => ({ id: optionId(j), text }));
              const want = comma ? (sign === "+" ? "," : "–") : (answers[a++] ?? "");
              const accepted = comma ? [want] : variants(want).map((v) => v || "–");
              const right = options
                .filter((o) => accepted.some((v) => v.toLowerCase() === o.text.toLowerCase()))
                .map((o) => o.id);
              if (!right.length)
                throw new Unmapped(`drop-down answer "${want}" is not one of its options`);
              gapDefs[`g${i + 1}`] = { options };
              answer[`g${i + 1}`] = right.length === 1 ? (right[0] as string) : right;
            });
            add({ segments: segs, gaps: gapDefs, display: "dropdown", answer }, hint);
          } else {
            const answer = Object.fromEntries(
              answers.map((a, i) => [`g${i + 1}`, { accepted: variants(a) }]),
            );
            add({ segments: segs, answer }, hint);
          }
        } catch (error) {
          if (!(error instanceof Unmapped)) throw error;
          skipped.push(`item ${u.n}: ${error.message}`);
        }
      }
      return done(selects ? { type: "gap_choice" } : { type: "gap_text" });
    }
    // Answer fields only: translate or rewrite the sentence (or the hint's sentence).
    for (const u of units) {
      const text = segText(u.segs) || u.hint || "";
      if (!u.key) {
        skipped.push(`item ${u.n}: no key entry`);
        continue;
      }
      const { reference, russian } = englishKey(u.key);
      const loc: LocaleItem = {};
      // A translation into Russian: the model answer is in the learner's language.
      const item: Record<string, unknown> = reference
        ? { input: "text", reference: [reference] }
        : { input: "text", reference: [], answerIn: "learner" };
      if (!reference) loc.reference = [plainText(u.key.join(" "))];
      if (isRussian(text)) loc.prompt = text;
      else if (text) {
        item.prompt = withoutIpa(withoutRussianRemarks(text));
        if (u.intro) loc.prompt = u.intro;
      }
      if (reference && russian.length && !isRussian(text)) loc.hintHtml = para(russian.join(" "));
      add(item, loc);
    }
    return done({ type: "respond" });
  }

  if (ex.qa.length) {
    for (const { q, a } of ex.qa)
      if (a) add({ prompt: q, input: "text", reference: a.split(/\s+\/\s+/) }, {});
    // "Listen to one way of doing it": a model answer read aloud.
    const audio = media(ex.players[0]?.audio);
    return done({ type: "respond", ...(audio ? { media: { audio } } : {}) });
  }

  if (ex.grid.length) {
    if (!ex.keyLines.length) throw new Homework("a grid of words without a key");
    // A word with a field per part of speech ("name n" / "v") is one row of the key.
    const grid =
      ex.grid.length === ex.keyLines.length
        ? ex.grid
        : ex.grid.reduce<Array<{ prompt: string; fields: number }>>((rows, row) => {
            const last = rows.at(-1);
            if (last && /^(n|v|a|adj|adv)$/.test(row.prompt)) {
              last.prompt += ` / ${row.prompt}`;
              last.fields += row.fields;
            } else rows.push({ ...row });
            return rows;
          }, []);
    if (ex.keyLines.length !== grid.length)
      throw new Unmapped(`a grid of ${ex.grid.length} rows with ${ex.keyLines.length} key lines`);
    grid.forEach((row, i) => {
      const line = ex.keyLines[i] ?? "";
      const prompt = row.prompt.replace(/\s+/g, " ");
      const head = /^\s*<strong>([^<]*)<\/strong>/.exec(line);
      const text = flatText(line);
      const cut = text.search(CYRILLIC);
      const en = withoutIpa(cut < 0 ? text : text.slice(0, cut))
        .replace(/\s*\d\)\s*$/, "")
        .replace(/[\s,;:–(-]+$/, "");
      // Only meanings (or the word itself in bold, then its meanings): write them in Russian.
      if (!latinLetters(en) || (head && prompt.startsWith(plainText(head[1])))) {
        const meaning = plainText(head ? line.slice(head[0].length) : line).replace(/,\s*$/, "");
        add(
          { prompt, input: "text", reference: [], answerIn: "learner" },
          { reference: [meaning] },
        );
        return;
      }
      const ru = cut < 0 ? "" : text.slice(cut).replace(/[\s,;]+$/, "");
      add({ prompt, input: "text", reference: [en] }, ru ? { hintHtml: para(ru) } : {});
    });
    return done({ type: "respond" });
  }

  if (ex.textarea) {
    const audio = media(ex.players[0]?.audio);
    const stimulus = audio ? { media: { audio } } : {};
    const key = ex.freeKey.map((l) => plainText(l)).join(" ");
    if (!key && ex.inline.length) {
      // Each word of the task carries its answer ("1856" → "eighteen fifty-six").
      for (const { prompt, answers } of ex.inline)
        if (prompt && answers.length) add({ prompt, input: "text", reference: answers }, {});
      return done({ type: "respond", ...stimulus });
    }
    if (!key) throw new Homework("open answer without a model answer");
    const texts = ex.paragraphs.map((p) => plainText(p)).filter(Boolean);
    const english = texts.filter((t) => !isRussian(t));
    const russian = texts.filter(isRussian);
    // Years or times written in figures ("1856, 200 н.э.") are not a translation.
    const learner =
      isRussian(key) && latinLetters(key) + (key.match(/\d/g)?.length ?? 0) < key.length / 4;
    add(
      {
        input: "text",
        reference: learner ? [] : [withoutRussianRemarks(key)],
        ...(learner ? { answerIn: "learner" } : {}),
        ...(english.length ? { prompt: english.join("\n") } : {}),
      },
      {
        ...(russian.length ? { prompt: russian.join("\n") } : {}),
        ...(learner ? { reference: [key] } : {}),
      },
    );
    return done({ type: "respond", ...stimulus });
  }

  const speech = speechItems(key, ex.players, media);
  if (speech.items.length) {
    items.push(...speech.items);
    Object.assign(locale, speech.locale);
    return done({ type: "speech_selfrate" });
  }
  if (SPEAKING.test(plainText(ex.instructionHtml))) {
    const text = ex.paragraphs
      .map((p) => plainText(p))
      .filter((t) => t && !isRussian(t))
      .join("\n");
    add(text ? { text } : {}, {});
    return done({ type: "speech_selfrate" });
  }
  throw new Homework("task without answer fields");
}
