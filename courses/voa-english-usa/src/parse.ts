// A lesson article → data. The articles are 2001 radio scripts moved through several CMS versions, so
// the same parts come in different markup: labels as `<p><strong>…:</strong>`, `<p /><strong>…:` or
// `<h3>…:</h3>`; the dialogue and word lists as tables (speaker | line, English | Russian [| example
// | пример]) or as `<br>`-separated lines with tabs or a single space between English and Russian.
// The parser first flattens the body into lines (table rows keep their cells), then walks them with the
// section labels as a state machine.
import {
  CYRILLIC,
  escapeHtml,
  plainText,
  sanitizeCourseHtml,
  splitAtCyrillic,
} from "@sprachanker/course-kit";

export interface DialogueLine {
  speaker?: string;
  text: string;
  /** A part title inside the dialogue ("Conversation #2"). */
  heading?: boolean;
}

export interface WordRow {
  /** Word-list heading the row is under ("Nouns", "Verbs", "Other words from previous lessons"). */
  category: string;
  en: string;
  ru: string;
  /** Usage examples in source order: English, and the Russian when the source gives one. */
  examples: { en: string; ru?: string }[];
}

/** A page of learner-language text: the homework, grammar notes or notes inside the word list. */
export interface NotePage {
  kind: "homework" | "grammar" | "culture";
  title: string;
  /** Sanitised course HTML (02). */
  html: string;
}

export interface ParsedLesson {
  /** «Урок английского языка №1». */
  title: string;
  /** «Цель»: what the learner should be able to do. */
  goal: string;
  /** «Содержание»: what happens in the episode. */
  synopsis: string;
  dialogue: DialogueLine[];
  words: WordRow[];
  pages: NotePage[];
  /** Text before the first known part, which the parser cannot place. */
  stray: string[];
}

interface Line {
  cells: string[];
  /** Source HTML of the line. */
  html: string;
  row: boolean;
}

type Section = "preamble" | "goal" | "synopsis" | "dialogue" | "words" | "notes";

const LATIN = /\p{Script=Latin}/u;
const EXAMPLE = /^(?:Example|Например)\s*:/;

/** Part labels; a label ends the line or is followed by a colon. */
const SECTIONS: [RegExp, Section, NotePage["kind"]?][] = [
  [/^Цель\s*:\s*/, "goal"],
  [/^Содержание\s*:\s*/, "synopsis"],
  [/^(?:Conversations?|Dialogues?)(?:\s*#?\s*\d+)?\s*(?::\s*|$)/i, "dialogue"],
  [/^Words\s+(?:and|&)\s+phrases\s*(?::\s*|$)/i, "words"],
  [/^(?:Homework\b[^:]*|Домашнее задание\s*):\s*/i, "notes", "homework"],
  [/^(?:Grammar|Usage)\s+(?:notes?|review)\b[^:]*(?::\s*|$)/i, "notes", "grammar"],
];

/** Word-list headings seen right after the dialogue when "Words and phrases" is missing. */
const WORD_HEADING =
  /^(?:Nouns?|Verbs?|Adjectives?|Adverbs?|Pronouns?|Prepositions?|Phrases?)\b[^:]*:$/i;
/** The usual first homework task, for the few lessons whose homework has no label. */
const HOMEWORK_START = /^1\.\s*Прочитайте/;
const HOMEWORK_TITLE = "Homework - Домашнее задание";

/** The article body (`<div class="wsw">`), or undefined when the page has none. */
function articleBody(html: string): string | undefined {
  const start = html.indexOf('<div class="wsw">');
  if (start < 0) return undefined;
  const end = html.indexOf('<div class="footer-toolbar"', start);
  return html.slice(start + '<div class="wsw">'.length, end < 0 ? undefined : end);
}

/** The body as lines in reading order; table rows keep their cells, tabs separate cells otherwise. */
function bodyLines(body: string): Line[] {
  const lines: Line[] = [];
  for (const part of body.split(/(<table[\s\S]*?<\/table>)/i)) {
    if (/^<table/i.test(part)) {
      for (const tr of part.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
        const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
          .map((m) => plainText(m[1]))
          .filter(Boolean);
        if (cells.length) lines.push({ cells, html: tr, row: true });
      }
      continue;
    }
    for (const piece of part.split(/<br\s*\/?>|<\/?(?:p|li|h\d|div|blockquote|ul|ol)\b[^>]*>/i)) {
      const cells = piece
        .split(/\t|&#9;/)
        .map((c) => plainText(c))
        .filter(Boolean);
      if (cells.length) lines.push({ cells, html: piece, row: false });
    }
  }
  return lines;
}

/**
 * A word-list row → English headword, Russian translation and an example pair. Cells come in either
 * order ("I | я | Example: … | Например: …", "What | Example: … | Что? | Например: …"); a single cell
 * is split where the Russian starts. A row that holds only an example (a second example of the
 * previous word) has no `en`.
 */
export function wordRow(cells: string[]): {
  en?: string;
  ru?: string;
  exampleEn?: string;
  exampleRu?: string;
} {
  const parts = cells
    .flatMap((c) => c.split(/\s+(?=(?:Example|Например)\s*:)/))
    .flatMap((c) => {
      if (!/^Example\s*:/.test(c)) return /^Например\s*:/.test(c) ? [c] : splitAtCyrillic(c);
      // "Example: I go there в течение" — the Russian after an English example is a plain part.
      const [example = c, russian] = splitAtCyrillic(c);
      return russian ? [example, russian] : [example];
    })
    .filter(Boolean);
  const example = (prefix: string) =>
    parts
      .find((p) => p.startsWith(prefix))
      ?.replace(EXAMPLE, "")
      .trim();
  const plain = parts.filter((p) => !EXAMPLE.test(p));
  const en = plain.find((p) => !CYRILLIC.test(p) && LATIN.test(p));
  const russian = plain.filter((p) => CYRILLIC.test(p));
  const exampleEn = example("Example");
  let exampleRu = example("Например");
  let ru = russian[0];
  // Only an example: its Russian side may come without "Например".
  if (!en && exampleEn) {
    exampleRu = [...russian, ...(exampleRu ? [exampleRu] : [])].join(" ") || undefined;
    ru = undefined;
  }
  return {
    ...(en ? { en } : {}),
    ...(ru ? { ru } : {}),
    ...(exampleEn ? { exampleEn } : {}),
    ...(exampleRu ? { exampleRu } : {}),
  };
}

/** "Mary:", "Mary Scott: Hello." → speaker and text, when the label is a name in Latin letters. */
function speakerLine(text: string): DialogueLine | undefined {
  const m = /^([^:]{1,40}):\s*(.*)$/.exec(text);
  if (!m?.[1] || !LATIN.test(m[1]) || CYRILLIC.test(m[1]) || /^Example$/i.test(m[1])) return;
  return { speaker: m[1].trim(), text: m[2]?.trim() ?? "" };
}

/** HTML of a page from its lines: table rows as a table, other lines as paragraphs. */
function pageHtml(lines: Line[]): string {
  let html = "";
  let rows: string[] = [];
  const flush = () => {
    if (rows.length) html += `<table><tbody>${rows.join("")}</tbody></table>`;
    rows = [];
  };
  for (const line of lines) {
    if (line.row) {
      rows.push(`<tr>${line.cells.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`);
      continue;
    }
    flush();
    html += `<p>${line.html.replace(/\t|&#9;/g, " ")}</p>`;
  }
  flush();
  return sanitizeCourseHtml(html, { image: () => undefined })
    .replace(/\s+/g, " ")
    .replace(/<p>\s+/g, "<p>")
    .replace(/\s+<\/p>/g, "</p>")
    .replace(/<p><\/p>/g, "")
    .trim();
}

export function parseLesson(page: string): ParsedLesson | undefined {
  const body = articleBody(page);
  if (body === undefined) return undefined;
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(page)?.[1];
  const lesson: ParsedLesson = {
    title: plainText(h1 ?? /<title>([\s\S]*?)<\/title>/i.exec(page)?.[1]),
    goal: "",
    synopsis: "",
    dialogue: [],
    words: [],
    pages: [],
    stray: [],
  };
  const pages: { kind: NotePage["kind"]; title: string; lines: Line[] }[] = [];
  let section: Section = "preamble";
  let category = "";
  /** The page that notes lines go to; in the word list, a page per heading opened on demand. */
  let page_: (typeof pages)[number] | undefined;
  let speaker: string | undefined;

  const openPage = (kind: NotePage["kind"], title: string) => {
    page_ = { kind, title, lines: [] };
    pages.push(page_);
    return page_;
  };

  const add = (line: Line): void => {
    const text = line.cells.join(" ");
    if (
      HOMEWORK_START.test(text) &&
      !line.row &&
      (section === "words" || section === "notes") &&
      !pages.some((p) => p.kind === "homework")
    ) {
      section = "notes";
      openPage("homework", HOMEWORK_TITLE);
    }
    switch (section) {
      case "goal":
      case "synopsis": {
        // A missing "Conversation:" label: the dialogue starts right after the synopsis.
        if (line.row ? /:$/.test(line.cells[0] ?? "") : speakerLine(text)?.text) {
          section = "dialogue";
          add(line);
          return;
        }
        lesson[section] = `${lesson[section]} ${text}`.trim();
        return;
      }
      case "dialogue": {
        if (!line.row && WORD_HEADING.test(text)) {
          section = "words";
          add(line);
          return;
        }
        const first = line.cells[0] ?? "";
        const said: DialogueLine =
          line.row && line.cells.length > 1 && /:$/.test(first)
            ? { speaker: first.replace(/:$/, "").trim(), text: line.cells.slice(1).join(" ") }
            : line.row
              ? { text }
              : (speakerLine(text) ?? { text });
        if (!said.text) {
          speaker = said.speaker;
          return;
        }
        const who = said.speaker ?? speaker;
        lesson.dialogue.push({ ...(who ? { speaker: who } : {}), text: said.text });
        speaker = undefined;
        return;
      }
      case "words": {
        if (!line.row && line.cells.length === 1 && /:$/.test(text) && !CYRILLIC.test(text)) {
          category = text.replace(/\s*:$/, "");
          page_ = undefined;
          return;
        }
        const row = wordRow(line.cells);
        const last = lesson.words.at(-1);
        const example = row.exampleEn
          ? [{ en: row.exampleEn, ...(row.exampleRu ? { ru: row.exampleRu } : {}) }]
          : [];
        if (row.en && row.ru) {
          lesson.words.push({ category, en: row.en, ru: row.ru, examples: example });
        } else if (!row.en && row.exampleEn && last) {
          // A second example of the word above.
          last.examples.push(...example);
        } else {
          // Explanations, tables without translations: kept as a page under the heading.
          const title = category || "Words and phrases";
          (page_ ?? openPage(/cultur/i.test(title) ? "culture" : "grammar", title)).lines.push(
            line,
          );
        }
        return;
      }
      case "notes":
        page_?.lines.push(line);
        return;
      case "preamble":
        lesson.stray.push(text);
    }
  };

  for (const line of bodyLines(body)) {
    const text = line.cells.join(" ");
    const label = line.row ? undefined : SECTIONS.find(([re]) => re.test(text));
    if (!label) {
      add(line);
      continue;
    }
    const [re, next, kind] = label;
    const head = text.match(re)?.[0] ?? "";
    const rest = text.slice(head.length).trim();
    // Numbered or repeated conversations keep their titles as headings of the dialogue.
    if (next === "dialogue" && (section === "dialogue" || /\d/.test(head))) {
      lesson.dialogue.push({ text: head.replace(/\s*:?\s*$/, ""), heading: true });
    }
    section = next;
    speaker = undefined;
    page_ = undefined;
    if (next === "words") category = "";
    if (kind) openPage(kind, head.replace(/\s*:?\s*$/, ""));
    if (rest) add({ cells: [rest], html: escapeHtml(rest), row: false });
  }
  lesson.pages = pages
    .map((p) => ({ kind: p.kind, title: p.title, html: pageHtml(p.lines) }))
    .filter((p) => p.html);
  return lesson;
}
