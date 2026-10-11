// HTML sanitiser for course texts (02, "Conventions": allow-list, images as media paths).
import type { MediaPath } from "@sprachanker/schema";
import sanitizeHtml from "sanitize-html";
import { NO_WIDTH } from "./text.ts";

const ALLOWED_TAGS = [
  "h3",
  "p",
  "br",
  "b",
  "strong",
  "i",
  "em",
  "small",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "figure",
  "figcaption",
  "img",
];

interface SanitizeOptions {
  /** Media path for an image source of the provider (e.g. a URL template); undefined drops the image. */
  image(attributes: Record<string, string>): MediaPath | undefined;
  /** Elements to drop with their content, e.g. credit lines. */
  drop?(tag: string, attributes: Record<string, string>): boolean;
}

/** A cell's span kept when it is one (2–99): a table's shape, not its look. */
const span = (tagName: string, attribs: sanitizeHtml.Attributes): sanitizeHtml.Tag => ({
  tagName,
  attribs: Object.fromEntries(
    ["rowspan", "colspan"].flatMap((a) =>
      /^(?:[2-9]|[1-9]\d)$/.test(attribs[a] ?? "") ? [[a, attribs[a] as string]] : [],
    ),
  ),
});

/** Keeps the allow-listed elements without attributes (images get `src` and `alt`, cells their
 *  `rowspan` and `colspan`); unwraps the rest. Characters of no width an editor left go. */
export function sanitizeCourseHtml(html: string, options: SanitizeOptions): string {
  const clean = sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      img: ["src", "alt"],
      td: ["rowspan", "colspan"],
      th: ["rowspan", "colspan"],
    },
    allowedSchemes: [],
    allowedSchemesAppliedToAttributes: [],
    allowProtocolRelative: false,
    transformTags: {
      td: span,
      th: span,
      img: (tagName, attribs): sanitizeHtml.Tag => {
        const src = options.image(attribs);
        return src
          ? { tagName, attribs: { src, alt: attribs.alt ?? "" } }
          : { tagName: "drop-image", attribs: {} as sanitizeHtml.Attributes };
      },
    },
    exclusiveFilter: (frame) =>
      frame.tag === "drop-image" || (options.drop?.(frame.tag, frame.attribs) ?? false),
  });
  // After sanitising: an entity (`&#8203;`) is a character by then.
  return nestedHeadingsAsBold(
    withoutEmpty(oneCellLabels(breakable(clean.replace(NO_WIDTH, "")))),
  ).trim();
}

/** A table of one cell with a line of text in it is a label (a case's name over its table): a bold
 *  paragraph, not a box. One holding paragraphs or lists (a framed note) stays a table. */
const oneCellLabels = (html: string) =>
  html.replace(
    /<table>\s*(?:<tbody>\s*)?<tr>\s*<t([dh])>((?:(?!<\/?(?:table|tr|td|th|p|ul|ol|li|figure|h3|br)\b)[\s\S])*)<\/t\1>\s*<\/tr>\s*(?:<\/tbody>\s*)?<\/table>/g,
    (_, _cell, text: string) => {
      const line = text.trim().replace(/^<(strong|b)>([\s\S]*)<\/\1>$/, "$2");
      return line ? `<p><strong>${line}</strong></p>` : "";
    },
  );

/** A no-break space between two letters is an editor's leftover ("und\u00a0leckeren", whole sentences
 *  so joined): a plain space, so the text wraps. One that keeps a number with its unit ("25\u00a0°C") or
 *  a mark off its word ("Bonjour\u00a0!") stays. */
const breakable = (html: string) => html.replace(/(?<=\p{L})(?:\u00a0|&nbsp;)(?=\p{L})/gu, " ");

/** Emphasis around nothing but spaces (an editor's leftover) gives just its spaces; a paragraph,
 *  caption or title left with nothing in it goes (a dropped credit leaves an empty caption). */
function withoutEmpty(html: string): string {
  let out = html;
  for (let prev = ""; prev !== out; ) {
    prev = out;
    out = out
      .replace(/<(strong|b|em|i|small)>(\s*)<\/\1>/g, "$2")
      .replace(/<(p|figcaption|h3)>(?:\s|<br \/>)*<\/\1>/g, "");
  }
  return out;
}

/** An `<h3>` titles a section of the page only outside tables, lists and figures (the app divides a
 *  page at its titles, 09); one inside them is a bold paragraph. */
function nestedHeadingsAsBold(html: string): string {
  let depth = 0;
  return html.replace(/<(\/?)(table|ul|ol|figure|h3)>/g, (tag, close: string, name: string) => {
    if (name !== "h3") {
      depth += close ? -1 : 1;
      return tag;
    }
    if (!depth) return tag;
    return close ? "</strong></p>" : "<p><strong>";
  });
}

/**
 * Sanitised course HTML whose sections are titled by a paragraph of bold text only ("<p><strong>Formal
 * greeting</strong></p>"): those paragraphs become `<h3>` section titles (a trailing colon dropped), so
 * the app can show each section on its own. Other bold text stays as it is.
 */
export function boldLinesAsHeadings(html: string): string {
  const titled = html.replace(
    /<p>\s*<(strong|b)>((?:(?!<\/?(?:strong|b|p)>).)+?)<\/\1>\s*<\/p>/gs,
    (_, _tag, title: string) => `<h3>${title.trim().replace(/\s*:$/, "")}</h3>`,
  );
  return nestedHeadingsAsBold(titled);
}

/** A space in HTML text: plain, no-break, or its entity. */
const SPACE = "(?:[ \\u00a0]|&nbsp;)";
const SPACE_RUN = new RegExp(`${SPACE}{2,}`, "g");
/** What may follow a mark that closes the word before it: the end, a space, a tag, a closing bracket
 *  or quote, a digit ("Angebot .1 Kilo"). A mark before a letter or another mark is not that word's:
 *  "Ja ... und", a smiley ("gut. :-)"), an opening ",,", a right-to-left edition's text kept as seen
 *  (": .Wort"). */
const MARK_END = `(?=$|[\\s<)\\]"“”»’\\d]|&nbsp;|&quot;)`;
/** Spaces after a word — not after an opening tag ("<em> .</em>") or another mark (": .99") — before
 *  its mark (through closing emphasis: "Morgen </strong>."); a closing bracket takes its mark after it
 *  ("(oben )."). */
const spaceBefore = (marks: string) =>
  new RegExp(
    `(?<![\\s,:;!?]|<(?!/)[^>]*>)${SPACE}+(?=(?:</(?:strong|b|em|i|small)>)*(?:[${marks}]${MARK_END}|[)\\]](?=[.,;:!?])))`,
    "gu",
  );
const BEFORE_MARKS = spaceBefore(".,!?;:)\\]");
const BEFORE_FRENCH_MARKS = spaceBefore(".,)\\]");
/** An opening quote or bracket opens only after a space, a line's start or another opening (Arabic
 *  writes „ “ the other way round: "كلمة “oder„ في"; "dann ...„ und" closes). */
const OPENS = "(?<=^|[\\s>(\\[])";
const AFTER_OPENING = new RegExp(`(${OPENS}[„(\\[])${SPACE}+`, "gu");
const BEFORE_CLOSING_QUOTE = new RegExp(`${OPENS}„([^„“”<]*?)${SPACE}+“(?![\\p{L}\\p{N}])`, "gu");
/** A run of spaces is one; a no-break one when it has one and keeps a mark or a unit with its word
 *  (French "Allemagne\u00a0?", "« oui »", "25\u00a0%"). */
const oneSpace = (run: string, at: number, html: string) =>
  /\u00a0|&nbsp;/.test(run) &&
  (/[?!:;»%°€]/.test(html.charAt(at + run.length)) || /[\d«]/.test(html.charAt(at - 1)))
    ? "\u00a0"
    : " ";
/** Spaces at the edges of a block or a line. */
const BLOCK_EDGES = new RegExp(
  `(<(?:p|li|td|th|h3|figcaption)>)${SPACE}+|${SPACE}+(?=</(?:p|li|td|th|h3|figcaption)>|<br />)`,
  "g",
);

/**
 * Spacing an editor left in course HTML (sanitised): a run of spaces and no-break spaces is one space,
 * none before a `. , ! ? ; : ) ]` that closes the word before it (`MARK_END`), none inside German
 * quotes („ … “) or after `( [`, none at the edges of a block or line (a block left empty goes). Line
 * breaks stay. French text keeps its space before `! ? ; :` (`french`).
 */
export function tidySpacing(html: string, options: { french?: boolean } = {}): string {
  return withoutEmpty(
    html
      .replace(SPACE_RUN, oneSpace)
      .replace(options.french ? BEFORE_FRENCH_MARKS : BEFORE_MARKS, "")
      .replace(AFTER_OPENING, "$1")
      .replace(BEFORE_CLOSING_QUOTE, "„$1“")
      .replace(BLOCK_EDGES, "$1"),
  );
}

/** Plain text as HTML text content: `&`, `<` and `>` escaped (quotes stay: not for attributes). */
export const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
