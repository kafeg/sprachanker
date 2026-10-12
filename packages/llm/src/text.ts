// Course HTML → plain text for prompts.
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** A table's cell as one line: a break or paragraph a space, other tags gone (a word's letters may be
 *  marked one by one), the source's line breaks and indentation too. */
const cellText = (html: string) =>
  html
    .replace(/<(br|\/?(p|div|li))\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

/** A table as lines: each row one line, its cells joined by " · ", empty cells and rows left out. */
const tableText = (table: string) =>
  [...table.matchAll(/<tr(?:\s[^>]*)?>([\s\S]*?)<\/tr>/gi)]
    .map(([, row]) =>
      [...(row ?? "").matchAll(/<t([dh])(?:\s[^>]*)?>([\s\S]*?)<\/t\1>/gi)]
        .map(([, , cell]) => cellText(cell ?? ""))
        .filter(Boolean)
        .join(" · "),
    )
    .filter(Boolean)
    .join("\n");

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, table: string) => `\n${tableText(table)}\n`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|h\d|li|ul|ol|figure)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      const code = e.startsWith("#x")
        ? Number.parseInt(e.slice(2), 16)
        : e.startsWith("#")
          ? Number(e.slice(1))
          : undefined;
      // A number past Unicode stays as written.
      if (code !== undefined) return code <= 0x10ffff ? String.fromCodePoint(code) : m;
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Cuts text to at most `max` characters at a line break where possible. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf("\n", max);
  return `${text.slice(0, cut > max / 2 ? cut : max)}\n…`;
}

/** English name of a language code for prompts: "ru" → "Russian". */
export const languageName = (code: string) =>
  new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;

/** A writing system and a test for one of its letters. */
export interface Script {
  name: string;
  letter: RegExp;
}

/** Writing systems told apart in a model's text. */
const SCRIPTS: Script[] = [
  "Latin",
  "Cyrillic",
  "Greek",
  "Armenian",
  "Georgian",
  "Hebrew",
  "Arabic",
  "Devanagari",
  "Bengali",
  "Thai",
  "Hangul",
  "Hiragana",
  "Katakana",
  "Han",
].map((name) => ({ name, letter: new RegExp(`\\p{Script=${name}}`, "u") }));

/** A language's writing systems, as its own name for itself shows them ("Deutsch", "Русский"). */
const ownScripts = (lang: string) => {
  const name = new Intl.DisplayNames([lang], { type: "language" }).of(lang) ?? "";
  return SCRIPTS.filter((s) => s.letter.test(name)).map((s) => s.name);
};

/** The scripts `lang` writes in that `other` does not use (Cyrillic for Russian beside German);
 *  none when the two share theirs. */
export function scriptsOnlyOf(lang: string, other: string): Script[] {
  const [own, others] = [ownScripts(lang), ownScripts(other)];
  return SCRIPTS.filter((s) => own.includes(s.name) && !others.includes(s.name));
}

/** Scripts whose every character is a word or a syllable of one: counted by character. */
const BY_CHARACTER = new Set(["Han", "Hiragana", "Katakana"]);

/** How much of a text is written in `scripts`: its words in them, a character a word in Chinese and
 *  Japanese ("柏林的Lisa" — three and one). */
const wordsIn = (text: string, scripts: Script[]) =>
  scripts.reduce(
    (n, s) =>
      n +
      (text.match(new RegExp(`${s.letter.source}${BY_CHARACTER.has(s.name) ? "" : "+"}`, "gu"))
        ?.length ?? 0),
    0,
  );

/** A text's share in `lang` that still makes it `lang`'s: names and a word or two in the other
 *  language's script beside it ("Lisa und Tom в Берлине") do not make it the other's. */
const OWN_SHARE = 0.2;

/** Whether a text reads as written in `lang` rather than in `other`, by the scripts only one of them
 *  uses: a fifth of its words at least in `lang`'s. Undefined when their scripts do not tell them
 *  apart (German and English) or the text has no word in either. */
export function writtenIn(text: string, lang: string, other: string): boolean | undefined {
  const [own, others] = [scriptsOnlyOf(lang, other), scriptsOnlyOf(other, lang)];
  if (!own.length || !others.length) return undefined;
  const [mine, theirs] = [wordsIn(text, own), wordsIn(text, others)];
  if (!mine && !theirs) return undefined;
  return mine > 0 && mine >= OWN_SHARE * (mine + theirs);
}

/** Alphabets with letters alike, which a model mixes inside a word ("Вопрos"). */
const ALIKE = SCRIPTS.filter((s) => ["Latin", "Cyrillic", "Greek"].includes(s.name));

/** The first word of `texts` written in two alphabets ("Вопрos"); undefined when none. */
export function mixedWord(texts: string[]): string | undefined {
  for (const text of texts)
    for (const word of text.match(/\p{L}+/gu) ?? [])
      if (ALIKE.filter((s) => s.letter.test(word)).length > 1) return word;
  return undefined;
}

/** The two languages as a task's rules name them: by their English names, or as placeholders for the
 *  learner's own prompt template (Settings → AI assistant → Advanced). */
export const languageNames = (language: string, target: string) => ({
  language: languageName(language),
  target: languageName(target),
});
export const PLACEHOLDER_NAMES = { language: "{language}", target: "{target}" } as const;

/** Rough token count: about 4 characters per token for German, English and Russian text. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/** Keeps the end of a list (the most recent entries) within `max` characters; "… " marks a cut. */
export function newest(items: string[], max: number, separator: string): string {
  const out: string[] = [];
  let size = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i] as string;
    if (size + item.length + separator.length > max) break;
    out.unshift(item);
    size += item.length + separator.length;
  }
  return (out.length < items.length ? "… " : "") + out.join(separator);
}

/** The first lines, in order, that fit `max` characters together. */
export function fitting(lines: string[], max: number): string[] {
  const out: string[] = [];
  let size = 0;
  for (const line of lines) {
    if (size + line.length > max) break;
    out.push(line);
    size += line.length;
  }
  return out;
}

/**
 * The most recent conversation turns that fit `budget` characters of text, oldest first. The latest
 * exchange (the last two turns) is always kept — a long one clipped — so "go on" never loses what
 * it continues.
 */
export function recentTurns<T extends { text: string }>(history: T[], budget: number): T[] {
  const out: T[] = [];
  let size = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i] as T;
    const room = budget - size;
    if (turn.text.length <= room) {
      out.unshift(turn);
      size += turn.text.length;
    } else if (out.length < 2) {
      const keep = Math.max(room, Math.floor(budget / 4));
      out.unshift({ ...turn, text: clip(turn.text, keep) });
      size += keep;
    } else break;
  }
  return out;
}
