// A writing module page (`schreiben.php`; research exams.md) read as the candidate meets it: its Teile
// ("Teil N", B1 "Aufgabe N"), each with its task — the situation, the points to write about, the word
// count, a text to answer (B1's guestbook: a picture and its text page) — and either a form to fill
// in (A1 Teil 1: gaps and a choice, the rest filled in already) or a box to write a text in, with the
// criteria the raters judge it by as the page gives them: each level's points and meaning (A1), the
// bands A–E with what each means (A2's table), or each criterion's maximum (B1).
import { decodeEntities, type El, findAll, isEl } from "@sprachanker/course-kit";
import {
  CHROME,
  isTextLeaf as isLeaf,
  type Picture,
  pageParts,
  pictureOf,
  textOf,
} from "./page.ts";

/** A line of a form: a field filled in already, a gap to fill (its number on the form), a choice. */
export interface FormField {
  label: string;
  /** What the form holds already. */
  value?: string;
  /** The number the form gives a gap ("(3)"). */
  gap?: number;
  /** A choice's options, in order (a gap answered by ticking one). */
  choices?: string[];
}

export interface WritingCriterion {
  title: string;
  /** Its levels from best to worst: the points where the page says them, what each means. */
  levels: Array<{ points?: number; text?: string }>;
  /** The most it gives, where the page says only that (B1). */
  max?: number;
  /** A 0 here makes the whole answer 0 (the page's note on the criterion). */
  voids: boolean;
}

export interface WritingTeil {
  number: number;
  title: string;
  /** The task: its lines in order, a point to write about as "• …". */
  instructions: string[];
  /** The points to write about (A1: each judged on its own). */
  points: string[];
  pictures: Picture[];
  /** Pages holding a text the task shows as a picture. */
  links: string[];
  form?: { id: string; action: string };
  /** A form to fill in: its title and lines. */
  heading?: string;
  fields: FormField[];
  /** The box written in: its label. */
  box?: string;
  criteria: WritingCriterion[];
}

export interface WritingModule {
  /** The page's lines before its first Teil (its time). */
  intro: string[];
  teile: WritingTeil[];
}

/** Every element in document order. */
const ordered = (root: El) => findAll(root, () => true);
const TEIL = /^(Teil|Aufgabe)\s*(\d+)$/;
/** "3 Punkte - Aufgabe voll erfüllt …", "1,5 Punkte - …". */
const LEVEL = /^(\d+(?:,\d+)?)\s+Punkte?\s*[-–]\s*(.+)$/;
/** "Erfüllung - maximal 10 Punkte". */
const MAXIMUM = /^(.+?)\s*[-–]\s*maximal\s+(\d+(?:,\d+)?)\s+Punkte?$/;
/** "Wird das Kriterium “Aufgabenerfüllung” mit E (0 Punkten) bewertet, ist die Punktzahl … 0". */
const VOIDS = /Wird das Kriterium\s*[“"„]?\s*([^”"“]+?)\s*[”"“]?\s*mit E\b/;
const number = (text: string) => Number(text.replace(",", "."));

/** The form's lines: inputs by their labels, its own paragraphs, a choice's options. */
function readForm(form: El): { heading?: string; fields: FormField[] } {
  const labels = findAll(form, (e) => e.tag === "label");
  const labelOf = (id: string) => labels.find((l) => l.attrs.for === id);
  const labelText = (id: string) => {
    const label = labelOf(id);
    return label ? textOf(label) : "";
  };
  const heading = findAll(form, (e) => /^h[4-6]$/.test(e.tag)).map(textOf)[0];
  const fields: FormField[] = [];
  /** A choice's options gather under the line naming it ("Zahlungsweise: (4)"). */
  let choice: FormField | undefined;
  for (const el of ordered(form)) {
    if (el.tag === "input" && (el.attrs.type ?? "text") === "text") {
      choice = undefined;
      const label = labelText(el.attrs.id ?? "");
      const value = decodeEntities(el.attrs.value ?? "").trim();
      const gap = /^\((\d+)\)$/.exec(value)?.[1];
      if ("readonly" in el.attrs || "disabled" in el.attrs) fields.push({ label, value });
      else fields.push({ label, ...(gap && { gap: Number(gap) }) });
    } else if (el.tag === "input" && el.attrs.type === "radio") {
      const label =
        labelOf(el.attrs.id ?? "") ?? labels.find((l) => findAll(l, (e) => e === el)[0]);
      if (choice && label) choice.choices = [...(choice.choices ?? []), textOf(label)];
    } else if (el.tag === "p" && isLeaf(el)) {
      if (findAll(el, (e) => e.tag === "label" || e.tag === "input").length) continue;
      const text = textOf(el);
      if (!text || CHROME.test(text)) continue;
      const gap = /\((\d+)\)\s*$/.exec(text);
      if (gap) {
        choice = { label: text.slice(0, gap.index).trim(), gap: Number(gap[1]) };
        fields.push(choice);
      } else {
        choice = undefined;
        fields.push({ label: text });
      }
    }
  }
  return { ...(heading && { heading }), fields };
}

/** A table of the bands A–E (A2): a row per aspect ("Aufgabenerfüllung* - Sprachfunktion"), the
 *  aspects of a criterion together; a level's meaning is its aspects' cells. */
function readBandTable(table: El): WritingCriterion[] {
  const out: WritingCriterion[] = [];
  for (const tr of findAll(table, (e) => e.tag === "tr")) {
    const cells = tr.children.filter((c): c is El => isEl(c) && (c.tag === "th" || c.tag === "td"));
    const head = cells[0] && cells[0].tag === "th" ? textOf(cells[0]) : "";
    const [criterion, aspect] = head.split(/\s+-\s+/);
    if (!criterion || !aspect) continue;
    const title = criterion.replace(/\*$/, "").trim();
    const name = (aspect.split(":")[0] as string).trim();
    let c = out.find((x) => x.title === title);
    if (!c) {
      c = { title, levels: [], voids: false };
      out.push(c);
    }
    cells.slice(1).forEach((cell, i) => {
      const text = textOf(cell);
      if (!text) return;
      const before = c.levels[i]?.text;
      c.levels[i] = { text: before ? `${before}; ${name}: ${text}` : `${name}: ${text}` };
    });
  }
  return out;
}

/** What follows the form: the criteria, as a list of levels under each title (A1), a list of maxima
 *  (B1) or a table of bands (A2), with the note on the criterion that voids the task. */
function readCriteria(after: El[]): WritingCriterion[] {
  const criteria: WritingCriterion[] = [];
  let pending: string | undefined;
  for (const el of after) {
    if (el.tag === "table") {
      criteria.push(...readBandTable(el));
      continue;
    }
    if (!isLeaf(el) || findAll(el, (e) => e.tag === "a").length) continue;
    const text = textOf(el);
    if (!text || CHROME.test(text)) continue;
    const voids = VOIDS.exec(text)?.[1];
    if (voids) {
      for (const c of criteria) if (c.title === voids) c.voids = true;
      continue;
    }
    const level = LEVEL.exec(text);
    const max = MAXIMUM.exec(text);
    if (level && pending !== undefined) {
      let c = criteria.at(-1);
      if (!c || c.title !== pending) {
        c = { title: pending, levels: [], voids: false };
        criteria.push(c);
      }
      c.levels.push({ points: number(level[1] as string), text: (level[2] as string).trim() });
    } else if (max)
      criteria.push({
        title: (max[1] as string).trim(),
        levels: [],
        max: number(max[2] as string),
        voids: false,
      });
    else if (el.tag === "p") pending = text;
  }
  return criteria;
}

export function readWriting(html: string): WritingModule {
  const { all, heads, intro } = pageParts(html);
  const teile: WritingTeil[] = [];
  heads.forEach((at, h) => {
    const head = all[at] as El;
    const title = textOf(head);
    const n = TEIL.exec(title)?.[2];
    if (!n) return;
    // A Teil runs to the next heading of its level; what is inside an element of it is counted once.
    const range = all.slice(at + 1, heads[h + 1] ?? all.length);
    const formAt = range.findIndex((e) => e.tag === "form");
    const form = range[formAt];
    const inForm = new Set(form ? findAll(form, () => true) : []);
    const before = formAt < 0 ? range : range.slice(0, formAt);
    const instructions: string[] = [];
    const points: string[] = [];
    const pictures: Picture[] = [];
    const links: string[] = [];
    for (const el of before) {
      if (el.tag === "img") {
        const picture = pictureOf(el);
        if (picture) pictures.push(picture);
      } else if (el.tag === "a" && /\.html?$/.test(el.attrs.href ?? ""))
        links.push(el.attrs.href as string);
      else if (
        isLeaf(el) &&
        !findAll(el, (e) => e.tag === "a" && /\.html?$/.test(e.attrs.href ?? "")).length
      ) {
        const text = textOf(el);
        if (!text || CHROME.test(text)) continue;
        if (el.tag === "li") points.push(text);
        instructions.push(el.tag === "li" ? `• ${text}` : text);
      }
    }
    const box = form && findAll(form, (e) => e.tag === "textarea")[0];
    const boxLabel =
      box && findAll(form, (e) => e.tag === "label" && e.attrs.for === box.attrs.id)[0];
    const filled = form && !box ? readForm(form) : { fields: [] };
    teile.push({
      number: Number(n),
      title,
      instructions,
      points,
      pictures,
      links,
      ...(form && { form: { id: form.attrs.id ?? "", action: form.attrs.action ?? "" } }),
      ...filled,
      ...(box && { box: boxLabel ? textOf(boxLabel) : "" }),
      criteria:
        formAt < 0 ? [] : readCriteria(range.slice(formAt + 1).filter((e) => !inForm.has(e))),
    });
  });
  return { intro, teile };
}
