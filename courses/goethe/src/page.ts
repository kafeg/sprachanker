// A module page of Goethe's accessible model tests (`hoeren.php`, `lesen.php`, …; research exams.md)
// read as what a candidate meets on it, in document order: a Teil's heading, headings, paragraphs,
// pictures, recordings (the n-th player is the page's n-th audio), forms and the questions in them —
// a fieldset with its legend and its options, or a table of one-letter answers. The markup is not
// well-formed, so it is read as a tolerant tree (course-kit `parseHtml`), never as XML.
import { findAll as all, decodeEntities, type El, isEl, parseHtml } from "@sprachanker/course-kit";

export interface Picture {
  src: string;
  alt: string;
  /** The page holding the picture's text (a text shown as a picture). */
  longdesc?: string;
}

export interface Choice {
  label: string;
  picture?: Picture;
  /** Marked already: the example's answer. */
  checked: boolean;
}

/** A question as a fieldset gives it. */
export interface Fieldset {
  legend: string;
  /** Radio options in their order. */
  choices: Choice[];
  /** Pictures not inside an option's label, in their order. */
  pictures: Picture[];
  /** Linked text pages (a picture's text), in their order. */
  links: string[];
  /** Tables in it written out (a timetable an option points to): caption, then a line per row. */
  tables: string[];
  /** A one-letter answer box ("Anzeige: _") or gaps of a form, with what they hold already. */
  typed: Array<{ label: string; value: string }>;
  /** Inputs that cannot be changed: the example. */
  disabled: boolean;
}

/** A table of one-letter answers: each column a question (its number, its line, what it holds). */
export interface AnswerTable {
  columns: Array<{ number: string; prompt: string; value: string; disabled: boolean }>;
}

export type Block =
  | { kind: "teil"; title: string }
  | { kind: "end" }
  | { kind: "heading"; level: number; text: string }
  | { kind: "text"; text: string }
  | { kind: "picture"; picture: Picture }
  | { kind: "audio"; src: string }
  | { kind: "form"; id: string; action: string }
  | { kind: "formEnd" }
  | { kind: "fieldset"; fieldset: Fieldset }
  | { kind: "table"; table: AnswerTable };

/** Text of an element: entities decoded, spaces collapsed. */
export function textOf(node: El): string {
  const parts: string[] = [];
  const walk = (el: El) => {
    for (const child of el.children) {
      if (!isEl(child)) parts.push(child.text);
      else if (child.tag === "br") parts.push(" ");
      else walk(child);
    }
  };
  walk(node);
  return decodeEntities(parts.join("")).replace(/\s+/g, " ").trim();
}

/** Blocks a leaf of text has none of. */
const IN_TEXT = new Set(["p", "li", "div", "ul", "ol", "table", "form"]);

/** A leaf of text: a paragraph or list item (or a heading below a part's, with `headings`) without
 *  blocks inside. */
export const isTextLeaf = (el: El, headings = false) =>
  (el.tag === "p" || el.tag === "li" || (headings && /^h[4-6]$/.test(el.tag))) &&
  !all(el, (e) => IN_TEXT.has(e.tag)).length;

/**
 * A page of parts (Schreiben, Sprechen): every element in document order, where each part's heading
 * (`h3`) is — the test begins at the page's "Inhalt" anchor, the navigation is before it — and the
 * page's lines before the first part (its time).
 */
export function pageParts(html: string): { all: El[]; heads: number[]; intro: string[] } {
  const elements = all(parseHtml(html), () => true);
  const start = Math.max(
    0,
    elements.findIndex((e) => e.attrs.id === "Inhalt"),
  );
  const heads = elements.flatMap((e, i) => (e.tag === "h3" && i > start ? [i] : []));
  const intro = elements
    .slice(start, heads[0] ?? elements.length)
    .filter((e) => e.tag === "p" && isTextLeaf(e))
    .map(textOf)
    .filter((t) => t && !CHROME.test(t));
  return { all: elements, heads, intro };
}

/** The page's audio files in player order (`var audio = ['…', …]`; the links beside the players are
 *  wrong on some pages). */
export function audioList(html: string): string[] {
  const list = /var\s+audio\s*=\s*\[([\s\S]*?)\]/.exec(html)?.[1] ?? "";
  return [...list.matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => (m[1] ?? m[2] ?? "").trim());
}

/** Lines a page shows around the test that are not part of it. */
export const CHROME =
  /^(maximal \d+ Punkte|Zurück zur |Zu den Aufgaben|Zu den Lösungen|Die Prüfungszeit für|Textinhalt (der|von)|Alternativ dazu|\(?Hörsequenz|Gebärdensprache|Lippenlese|Ihre Auswahl)/i;
/** Player controls and decoration, not pictures of the test. */
const NOT_A_PICTURE = /\/(play|pause|stop|Pfeil_links|GI_Logo|Leiste)[^/]*\.(gif|png|jpe?g)$/i;
/** Elements whose text is one paragraph of the page. */
const TEXTS = new Set(["p", "td", "th", "li", "dd", "dt"]);
const BLOCKS = new Set([
  "p",
  "td",
  "th",
  "li",
  "dd",
  "dt",
  "div",
  "table",
  "ul",
  "ol",
  "img",
  "fieldset",
]);

export const pictureOf = (img: El): Picture | undefined => {
  const src = img.attrs.src ?? "";
  if (!src || NOT_A_PICTURE.test(src)) return undefined;
  return {
    src,
    alt: decodeEntities(img.attrs.alt ?? "").trim(),
    ...(img.attrs.longdesc && { longdesc: img.attrs.longdesc }),
  };
};

function readFieldset(fs: El): Fieldset {
  const legendEl = all(fs, (e) => e.tag === "legend")[0];
  const labels = all(fs, (e) => e.tag === "label");
  const labelFor = (id: string) => labels.find((l) => l.attrs.for === id);
  const inputs = all(fs, (e) => e.tag === "input");
  const radios = inputs.filter((i) => i.attrs.type === "radio");
  const inLabel = new Set<El>();
  const choices = radios.map((r) => {
    const label = labelFor(r.attrs.id ?? "") ?? labels.find((l) => all(l, (e) => e === r).length);
    const img = label && all(label, (e) => e.tag === "img")[0];
    if (img) inLabel.add(img);
    const picture = img && pictureOf(img);
    return {
      label: label ? textOf(label) : "",
      ...(picture && { picture }),
      checked: "checked" in r.attrs,
    };
  });
  const pictures = all(fs, (e) => e.tag === "img" && !inLabel.has(e)).flatMap(
    (img) => pictureOf(img) ?? [],
  );
  const links = all(fs, (e) => e.tag === "a" && /\.html?$/.test(e.attrs.href ?? "")).map(
    (a) => a.attrs.href as string,
  );
  const tables = all(fs, (e) => e.tag === "table").map((table) => {
    const caption = all(table, (e) => e.tag === "caption")[0];
    const rows = all(table, (e) => e.tag === "tr").map((tr) =>
      tr.children
        .filter((c): c is El => isEl(c) && (c.tag === "th" || c.tag === "td"))
        .map(textOf)
        .join("  ")
        .trim(),
    );
    return [caption ? textOf(caption) : "", ...rows].filter(Boolean).join("\n");
  });
  const typed = inputs
    .filter((i) => (i.attrs.type ?? "text") === "text")
    .map((i) => ({
      label: textOf(
        labelFor(i.attrs.id ?? "") ?? { type: "el", tag: "x", attrs: {}, children: [] },
      ),
      value: decodeEntities(i.attrs.value ?? "").trim(),
    }));
  return {
    legend: legendEl ? textOf(legendEl) : "",
    choices,
    pictures,
    links,
    tables,
    typed,
    disabled: inputs.some((i) => "disabled" in i.attrs || "readonly" in i.attrs),
  };
}

/** A table whose cells hold one-letter answers: numbers in its header row, a line per question
 *  (a weekday), an input per question. */
function readAnswerTable(table: El): AnswerTable {
  const rows = all(table, (e) => e.tag === "tr");
  const cells = (tr: El) =>
    tr.children.filter((c): c is El => isEl(c) && (c.tag === "th" || c.tag === "td"));
  const inputs = all(table, (e) => e.tag === "input" && (e.attrs.type ?? "text") === "text");
  // A row's first cell is its label ("Tag") when the row has one cell more than there are answers.
  const own = (tr: El | undefined) => {
    const row = tr ? cells(tr).map(textOf) : [];
    return row.length === inputs.length + 1 ? row.slice(1) : row;
  };
  const header = own(rows[0]);
  const lines = rows.slice(1).filter((tr) => !all(tr, (e) => e.tag === "input").length);
  const promptRow = own(lines[0]);
  return {
    columns: header.map((number, i) => {
      const input = inputs[i];
      return {
        number,
        prompt: promptRow[i] ?? "",
        value: decodeEntities(input?.attrs.value ?? "").trim(),
        disabled: !!input && ("disabled" in input.attrs || "readonly" in input.attrs),
      };
    }),
  };
}

/** The test part of a module page as blocks in document order. */
export function readPage(html: string): Block[] {
  const audio = audioList(html);
  let nextAudio = 0;
  const root = parseHtml(html);
  // The test begins at the page's "Inhalt" anchor (the navigation is before it); a page without one
  // is read whole.
  let started = !all(root, (e) => e.attrs.id === "Inhalt").length;
  const blocks: Block[] = [];
  const out = { push: (b: Block) => started && blocks.push(b) };
  const walk = (el: El) => {
    for (const child of el.children) {
      if (!isEl(child)) continue;
      const tag = child.tag;
      const id = child.attrs.id ?? "";
      if (id === "Inhalt") started = true;
      // A player: the n-th audio one is the page's n-th recording; the videos beside it are left.
      if (/^audio_player\d+$/.test(id)) {
        const src = audio[nextAudio++];
        if (src) out.push({ kind: "audio", src });
        continue;
      }
      if (
        /^(gebaerden|lippen|video)_player\d*$/.test(id) ||
        /\bplayer_v\b/.test(child.attrs.class ?? "")
      )
        continue;
      if (tag === "h3") {
        const text = textOf(child);
        out.push(
          /^(Teil|Aufgabe)\s*\d+/.test(text) ? { kind: "teil", title: text } : { kind: "end" },
        );
      } else if (/^h[2-6]$/.test(tag)) {
        if (tag !== "h2") out.push({ kind: "heading", level: Number(tag[1]), text: textOf(child) });
      } else if (tag === "form") {
        out.push({ kind: "form", id, action: child.attrs.action ?? "" });
        walk(child);
        out.push({ kind: "formEnd" });
      } else if (tag === "fieldset") {
        out.push({ kind: "fieldset", fieldset: readFieldset(child) });
      } else if (tag === "table" && all(child, (e) => e.tag === "input").length) {
        out.push({ kind: "table", table: readAnswerTable(child) });
      } else if (tag === "img") {
        const picture = pictureOf(child);
        if (picture) out.push({ kind: "picture", picture });
      } else if (TEXTS.has(tag) && !all(child, (e) => BLOCKS.has(e.tag)).length) {
        // A paragraph's own text; a player's label ("Hörsequenz (.mp4, …)") is not one.
        if (all(child, (e) => e.tag === "a" && /^javascript:/i.test(e.attrs.href ?? "")).length)
          continue;
        const text = textOf(child);
        if (text && !CHROME.test(text)) out.push({ kind: "text", text });
      } else walk(child);
    }
  };
  walk(root);
  return blocks;
}

/** A picture's text page (`longdesc`): its lines — paragraphs, list items ("• …") — without the way
 *  back to the test or a tracker's script. */
export function readLongdesc(html: string): string {
  const body = /<body[^>]*>([\s\S]*?)(?:<\/body>|$)/i.exec(html)?.[1] ?? html;
  const text = body
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<a\b[^>]*>\s*zurück[\s\S]*?<\/a>/gi, "")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<(br|\/p|p|\/li|\/h\d|h\d|\/div|div|\/ul|ul|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "  ")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line) => line && line !== "•")
    .join("\n");
}
