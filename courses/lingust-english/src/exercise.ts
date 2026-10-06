// A source exercise → one of our types (02). Mechanics, by the answer fields of the page:
//   gaps in English sentences (inputs)      → gap_text   (answers: the key's bold part; "/" = variants)
//   gaps as drop-down lists (selects)       → gap_choice (dropdown)
//   Russian sentence + answer field         → respond    (reference: the key's English sentence)
//   English sentence to transform/question  → respond    (prompt in canonical, reference from the key)
//   Question/Answer rows                    → respond    (reference: the answers shown)
//   text answer field with a whole-text key → respond    (one item; stimulus audio if any)
//   players / reading or speaking tasks     → speech_selfrate
// Translations into Russian, check boxes, word grids and tasks without a key → unknown + report.
import type { ExerciseDraft } from "@sprachanker/course-kit";
import { plainText } from "@sprachanker/course-kit";
import { type ExerciseKey, itemKey, type LocaleItem, type MediaPath } from "@sprachanker/schema";
import type { KeyEntry, Line, Seg, Snippet, SourceExercise, Unit } from "./parse.ts";
import { hasCyrillic, isRussian, latinLetters, withoutIpa, withoutRussianRemarks } from "./text.ts";

export class Unmapped extends Error {}

export interface Mapped {
  draft: Omit<ExerciseDraft, "key" | "newWords" | "ruleIds">;
  items: Record<string, LocaleItem>;
  /** Items left out (no key entry, answers not matching the gaps), with the reason. */
  skipped: string[];
}

type Media = (url: string | undefined) => MediaPath | undefined;

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const para = (text: string) => `<p>${escapeHtml(text)}</p>`;

/** Accepted variants of one answer: "who/that" → both; "(the) car" → also "car" and "the car". */
export function variants(answer: string): string[] {
  const out = new Set<string>();
  for (const v of answer.split("/").map((s) => s.trim())) {
    if (!v) continue;
    out.add(v);
    if (/\(.*\)/.test(v)) {
      out.add(v.replace(/\s*\([^)]*\)\s*/g, " ").trim());
      out.add(v.replace(/[()]/g, "").trim());
    }
  }
  return [...out].filter(Boolean);
}

/** "<strong>comes, does, is</strong>: Ник …" → answers per gap and the translation. */
export function gapKey(entry: KeyEntry, gaps: number): { answers: string[]; translation: string } {
  const first = entry[0] ?? "";
  // The answers are in bold, before the colon that starts the translation; remarks between bold
  // parts ("(можно: more happy)") are not answers.
  const bold =
    /^[\s\S]*?(?:<\/strong>\s*:|:\s*<\/strong>)/.exec(first) ?? /^[\s\S]*<\/strong>/.exec(first);
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
export function englishKey(entry: KeyEntry): { reference?: string; russian: string[] } {
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

  if (units.some((u) => u.checkbox)) throw new Unmapped("check boxes (commas) next to the gaps");
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
          const { answers, translation } = gapKey(u.key, gaps.length);
          const hint = hasCyrillic(translation) ? { hintHtml: para(translation) } : {};
          const segs = segments(u);
          if (selects) {
            const gapDefs: Record<string, { options: Array<{ id: string; text: string }> }> = {};
            const answer: Record<string, string> = {};
            gaps.forEach((g, i) => {
              const opts = [...(g as { options: string[] }).options, ...(none ? ["–"] : [])];
              const options = opts.map((text, j) => ({ id: String.fromCharCode(97 + j), text }));
              const right = options.filter((o) =>
                variants(answers[i] ?? "").some((v) => v.toLowerCase() === o.text.toLowerCase()),
              );
              if (right.length !== 1)
                throw new Unmapped(`drop-down answer "${answers[i]}" is not one of its options`);
              gapDefs[`g${i + 1}`] = { options };
              answer[`g${i + 1}`] = (right[0] as { id: string }).id;
            });
            add({ segments: segs, gaps: gapDefs, display: "dropdown", answer }, hint);
          } else {
            const answer = Object.fromEntries(
              answers.map((a, i) => [`g${i + 1}`, { accepted: variants(a) }]),
            );
            if (Object.values(answer).some((a) => !a.accepted.length))
              throw new Unmapped("empty answer in the key");
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
    let russianKeys = 0;
    for (const u of units) {
      const text = segText(u.segs) || u.hint || "";
      if (!u.key) {
        skipped.push(`item ${u.n}: no key entry`);
        continue;
      }
      const { reference, russian } = englishKey(u.key);
      if (!reference) {
        russianKeys++;
        skipped.push(`item ${u.n}: the model answer is Russian`);
        continue;
      }
      const loc: LocaleItem = {};
      const item: Record<string, unknown> = { input: "text", reference: [reference] };
      if (isRussian(text)) loc.prompt = text;
      else if (text) {
        item.prompt = withoutIpa(withoutRussianRemarks(text));
        if (u.intro) loc.prompt = u.intro;
      }
      if (russian.length && !isRussian(text)) loc.hintHtml = para(russian.join(" "));
      add(item, loc);
    }
    if (!items.length && russianKeys)
      throw new Unmapped(
        "translation into Russian: the model answers are in the learner's language",
      );
    return done({ type: "respond" });
  }

  if (ex.qa.length) {
    for (const { q, a } of ex.qa)
      if (a) add({ prompt: q, input: "text", reference: a.split(/\s+\/\s+/) }, {});
    // "Listen to one way of doing it": a model answer read aloud.
    const audio = media(ex.players[0]?.audio);
    return done({ type: "respond", ...(audio ? { media: { audio } } : {}) });
  }

  if (ex.gridFields) throw new Unmapped("a grid of words with answer fields");

  if (ex.textarea) {
    const key = ex.freeKey.map((l) => plainText(l)).join(" ");
    if (!key) throw new Unmapped("open answer without a model answer");
    // Years or times written in figures ("1856, 200 н.э.") are not a translation.
    if (isRussian(key) && latinLetters(key) + (key.match(/\d/g)?.length ?? 0) < key.length / 4)
      throw new Unmapped("translation into Russian: the model answer is in the learner's language");
    const texts = ex.paragraphs.map((p) => plainText(p)).filter(Boolean);
    const english = texts.filter((t) => !isRussian(t));
    const russian = texts.filter(isRussian);
    const audio = media(ex.players[0]?.audio);
    add(
      {
        input: "text",
        reference: [withoutRussianRemarks(key)],
        ...(english.length ? { prompt: english.join("\n") } : {}),
      },
      russian.length ? { prompt: russian.join("\n") } : {},
    );
    return done({ type: "respond", ...(audio ? { media: { audio } } : {}) });
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
  throw new Unmapped("task without answer fields");
}
