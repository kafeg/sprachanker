// DW-specific text: player labels, vocabulary chips, right-to-left texts kept as seen.
import { decodeEntities, plainLines, plainText } from "@sprachanker/course-kit";
import type { ApolloState } from "../apollo.ts";

/** The player's labels known before a page tells its own (pages without their interface strings). */
const KNOWN_LABELS = ["Прослушать аудио", "Play audio", "Audio abspielen"];

/** A label as compared: case and its closing mark aside (the page's "Putar audio.", the field's
 *  "Putar audio!"). */
const labelKey = (label: string) =>
  label
    .trim()
    .replace(/[\s.!…]+$/u, "")
    .toLocaleLowerCase();

/**
 * Labels of DW's player that appear in content fields, not content: the page's own interface strings
 * (`i18nByLang(…).all`, `exercise.playAudio`), so every edition language is covered.
 */
export function uiLabels(state: ApolloState): Set<string> {
  const labels = new Set(KNOWN_LABELS.map(labelKey));
  const root = state.ROOT_QUERY as Record<string, unknown> | undefined;
  for (const [key, value] of Object.entries(root ?? {})) {
    if (!key.startsWith("i18nByLang")) continue;
    try {
      const all = (value as { all?: unknown }).all;
      const strings = JSON.parse(typeof all === "string" ? all : "{}") as {
        exercise?: { playAudio?: unknown };
      };
      const label = strings.exercise?.playAudio;
      if (typeof label === "string" && labelKey(label)) labels.add(labelKey(label));
    } catch {
      // Interface strings that do not read: the known labels stay.
    }
  }
  return labels;
}

export const isUiLabel = (text: string, labels: Set<string>) => labels.has(labelKey(text));

/** The opening tag of a vocabulary chip: a word of the text linked to its vocabulary entry. */
const CHIP = /<span\b[^>]*\bclass="[^"]*\beditable placeholder\b[^"]*"[^>]*>/g;
const SPAN = /<(\/?)span\b[^>]*>/g;
/** Marks a chip's edges until the spaces are decided (a character of private use: never content). */
const EDGE = "\ue000";
/** A chip's edge with a letter, digit or dash on both sides (after `, ; : ! ?` too: "Mann:<chip>"),
 *  tags, characters of no width and other edges between (two chips side by side give two spaces:
 *  `tidySpacing` makes them one). */
const WORD_EDGE =
  /(?<=(?:[\p{L}\p{N}\u2013\u2014,:!?]|(?<!&#?\w+);|&[nm]dash;)(?:<[^>]*>|[\ue000\u200b\ufeff])*)\ue000(?=(?:<[^>]*>|[\ue000\u200b\ufeff])*(?:[\p{L}\p{N}\u2013\u2014]|&[nm]dash;))/gu;
/** Marks a chip's edge inside a word (a hyphenated one too: "<chip>Wellness</chip>-Hotel"); its span
 *  tags there go, so that no reading of the text (plain text makes tags spaces) splits the word. */
const INSIDE = "\ue001";
const IN_WORD =
  /(?<=[\p{L}\u2010\u2011-])(?:<\/?span\b[^>]*>)*\ue001(?:<\/?span\b[^>]*>)*(?=[\p{L}\u2010\u2011-])/gu;
/** A hyphen right at a chip's edge, only tags between. */
const HYPHEN_BEFORE = /[\u2010\u2011-](?:<[^>]*>)*$/u;
const HYPHEN_AFTER = /^[\u2010\u2011-]/u;

/** Where the span open at `start` closes: its closing tag's place and length; none when it does not. */
function closingSpan(html: string, start: number) {
  SPAN.lastIndex = start;
  let depth = 1;
  for (let m = SPAN.exec(html); m; m = SPAN.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (!depth) return { at: m.index, length: m[0].length };
  }
  return undefined;
}

/** Spaces at a marked word's edges, kept outside its mark. */
const EDGE_SPACES = /^((?:\s|&nbsp;|&#160;)*)([\s\S]*?)((?:\s|&nbsp;|&#160;)*)$/;

/**
 * DW's vocabulary chips as marked words (`<mark>`, 02): DW shows them so, and its tasks point at them
 * ("обращая особое внимание на новые слова"). After `spaceChips`: a chip it took into a word has lost
 * its opening tag and stays unmarked; the spaces it put back stay outside the mark.
 */
export function markChips(html: string): string {
  let out = "";
  let last = 0;
  for (const open of html.matchAll(CHIP)) {
    const at = open.index ?? 0;
    const start = at + open[0].length;
    const close = closingSpan(html, start);
    // A chip inside one already marked, or never closed: as it is (the sanitiser unwraps it).
    if (at < last || !close) continue;
    const [, before, word, after] = EDGE_SPACES.exec(html.slice(start, close.at)) ?? [];
    out += `${html.slice(last, at)}${before}${word ? `<mark>${word}</mark>` : ""}${after}`;
    last = close.at + close.length;
  }
  return out + html.slice(last);
}

const textOf = (html: string) => plainText(html).toLocaleLowerCase();
/** The headword a chip links to, without its article or a leading note: "der Brauch, die Bräuche" →
 *  "Brauch, die Bräuche". */
const headOf = (title: string) =>
  decodeEntities(title)
    .replace(/^\s*(?:\([^)]*\)\s*)?(?:(?:der|die|das)\s+)?/, "")
    .trim();

/**
 * DW's vocabulary chips (`<span class="editable placeholder">`, often in an `invalid_placeholder`
 * span) are shown with room around them, so the source leaves out the spaces next to them ("Wir
 * <chip>lernen</chip>Deutsch.", "eine<chip>Pause</chip> ."): where a chip's word meets a letter or
 * digit, a space goes back. Not inside a word: a chip on a compound's tail ("Weihnachts<chip>bräuche
 * </chip>", its headword a noun: "der Brauch"), on a word's beginning ("<chip>wiede</chip>r", its
 * headword "wieder"), or at a hyphen it touches ("<chip>Massage</chip>-<chip>Gutschein</chip>",
 * "<chip>Hin</chip>- und"). A chip on a compound's head ("<chip>Lamm</chip>fleisch") is not told from
 * one whose space was left out ("<chip>Garage</chip>haben wir nicht"): the markup is the same, and DW
 * shows both apart, so both get the space. Other spacing is `tidySpacing`'s.
 */
export function spaceChips(html: string): string {
  const edges: Array<{ at: number; mark: string }> = [];
  for (const open of html.matchAll(CHIP)) {
    const start = (open.index ?? 0) + open[0].length;
    const end = closingSpan(html, start)?.at;
    const head = headOf(/\bdata-title="([^"]*)"/.exec(open[0])?.[1] ?? "");
    const word = plainText(html.slice(start, end ?? start));
    const tail = /^\p{Ll}/u.test(word) && /^\p{Lu}/u.test(head);
    const hyphened = HYPHEN_BEFORE.test(
      html.slice(Math.max(0, (open.index ?? 0) - 200), open.index),
    );
    edges.push({ at: start, mark: tail || hyphened ? INSIDE : EDGE });
    if (end === undefined) continue;
    const after = html.slice(end, end + 200).replace(/^(?:<[^>]*>)+/, "");
    const next = /^\p{L}+/u.exec(after)?.[0];
    const words = new Set(textOf(head).split(/[^\p{L}]+/u));
    const begun = next && words.has(`${textOf(word).split(" ").pop()}${next.toLocaleLowerCase()}`);
    edges.push({ at: end, mark: begun || HYPHEN_AFTER.test(after) ? INSIDE : EDGE });
  }
  if (!edges.length) return html;
  let marked = "";
  let last = 0;
  for (const { at, mark } of edges.sort((a, b) => a.at - b.at)) {
    marked += html.slice(last, at) + mark;
    last = at;
  }
  marked += html.slice(last);
  return marked
    .replace(IN_WORD, "")
    .replaceAll(INSIDE, "")
    .replace(WORD_EDGE, " ")
    .replaceAll(EDGE, "");
}

const chipsSpaced = (value: unknown) =>
  typeof value === "string" ? spaceChips(value) : (value ?? "");
/** Plain text of a DW field, its chips spaced (`spaceChips`). */
export const plain = (value: unknown) => plainText(chipsSpaced(value));
/** Plain lines of a DW field (a cloze text), its chips spaced. */
export const plainLinesOf = (value: unknown) => plainLines(chipsSpaced(value));

/** Brackets as seen from the other side. */
const MIRROR: Record<string, string> = {
  "(": ")",
  ")": "(",
  "[": "]",
  "]": "[",
  "«": "»",
  "»": "«",
};
/** Closing punctuation (then spaces, more of it, brackets) before a text's first letter. */
const LEADING = /^([?!.…؟][\s?!.…؟:;,()[\]«»"'„“]*)(?=\p{L})/u;

/**
 * A text as written, from one DW's right-to-left editions (Arabic, Persian) keep in the order it is
 * seen: its closing punctuation typed first — German ("?Was trinkst du", "!(Ich mag (nicht", "?...
 * Was passiert, wenn") and the edition's own (".با نه پاسخ بده"). That run goes back to the end,
 * reversed and its brackets turned ("Was trinkst du?", "Ich mag (nicht)!"); a text that ends in
 * punctuation already is left as it is ("… um 6 mit Nina."), and so is one that opens with a bracket
 * ("(etwas) studieren").
 */
export function writtenOrder(text: string): string {
  const run = LEADING.exec(text)?.[1];
  if (!run || /[.?!…؟:;)\]»"“]$/.test(text.trimEnd())) return text;
  const closing = [...run]
    .reverse()
    .map((c) => MIRROR[c] ?? c)
    .join("");
  return `${text.slice(run.length)}${closing}`;
}
