// New words of a lesson: the bold words of its transcript, regular inflections folded into their base.
import { type Headword, plainText, shapeHeadword } from "@sprachanker/course-kit";
import { lemmaSlug } from "@sprachanker/schema";

/** Part of speech by shape (the site gives none; `shapeHeadword`). */
export const headword = (text: string): Headword => shapeHeadword("en", text);

const EDGE = /^[\s"“”'‘’([—–-]+|[\s"“”'‘’)\].,!?;:—–-]+$/g;

/**
 * New words of a transcript: its bold words in order, punctuation trimmed, each once. Speaker labels
 * ("Anna:") and lines that are bold as a whole (sub-headings) are not words.
 */
export function boldWords(html: string): string[] {
  const words: string[] = [];
  const seen = new Set<string>();
  const joined = html.replace(/<\/(strong|b)><(strong|b)>/gi, "");
  for (const block of joined.split(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/td>/i)) {
    const line = plainText(block);
    for (const m of block.matchAll(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      const raw = plainText(m[2]);
      const word = raw.replace(EDGE, "");
      if (!word || word.length < 2 || raw.endsWith(":") || raw === line) continue;
      const slug = lemmaSlug(word);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      words.push(word);
    }
  }
  return words.filter((w) => !inflectionOf(w, words));
}

/**
 * Whether `word` is a regular inflection of another bold word of the lesson ("parks" with "park",
 * "watching" with "watch", "danced" with "dance"): the base form stays, the duplicate goes.
 */
function inflectionOf(word: string, words: string[]): boolean {
  const w = word.toLowerCase();
  return words.some((other) => {
    const b = other.toLowerCase();
    if (b === w || /\s/.test(b)) return false;
    const stem = b.endsWith("e") ? b.slice(0, -1) : b;
    const doubled = b + b.at(-1);
    return [
      `${b}s`,
      `${b}es`,
      `${b}d`,
      `${b}ed`,
      `${b}ing`,
      `${stem}ing`,
      `${doubled}ed`,
      `${doubled}ing`,
      ...(b.endsWith("y") ? [`${b.slice(0, -1)}ies`, `${b.slice(0, -1)}ied`] : []),
    ].includes(w);
  });
}
