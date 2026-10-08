// Plain text from a source's HTML fields (providers' normalisers).

const NAMED: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  bdquo: "„",
  laquo: "«",
  raquo: "»",
  hellip: "…",
  shy: "",
  euro: "€",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  szlig: "ß",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
};

/** Character references (`&#x27;`, `&#39;`) and the common named entities decoded; others kept. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
    const code = /^#x/i.test(name)
      ? Number.parseInt(name.slice(2), 16)
      : name.startsWith("#")
        ? Number(name.slice(1))
        : undefined;
    // A number past Unicode is kept as written (it would throw).
    if (code !== undefined) return code <= 0x10ffff ? String.fromCodePoint(code) : match;
    return NAMED[name] ?? match;
  });
}

/** Text without tags and entities, whitespace collapsed, NFC. */
export function plainText(html: unknown): string {
  return (
    decodeEntities(String(html ?? "").replace(/<[^>]+>/g, " "))
      .replace(/[\s ]+/g, " ")
      // Tags around words ("<span>bitte</span>.") leave a space before punctuation; adjacent tags
      // ("<span>Appetit</span><span>auf</span>") must still separate words, so tags become spaces first.
      // Spaced ellipses ("Ja ... und") are the source's own.
      .replace(/ (?=[.,!?;:)\]])(?!\.\.)/g, "")
      .replace(/([([]) /g, "$1")
      .trim()
      .normalize("NFC")
  );
}

/** Text keeping line breaks of `<br>` and paragraphs (dialogues in cloze texts). */
export function plainLines(html: unknown): string {
  return String(html ?? "")
    .replace(/<br\s*\/?>|<\/p>/gi, "\n")
    .split("\n")
    .map((line) => plainText(line))
    .filter(Boolean)
    .join("\n");
}

// Two scripts in one line (the ru → en courses: Russian explanations and English examples share an
// element; Cyrillic vs Latin tells them apart).
export const CYRILLIC = /\p{Script=Cyrillic}/u;
export const hasCyrillic = (text: string) => CYRILLIC.test(text);
/** Cyrillic letters in a text. */
export const cyrillicLetters = (text: string) => text.match(/\p{Script=Cyrillic}/gu)?.length ?? 0;
/** Latin letters in a text, accented ones too (how much of it is in a Latin-script language). */
export const latinLetters = (text: string) => text.match(/\p{Script=Latin}/gu)?.length ?? 0;

/** Splits text where Cyrillic starts after Latin-script text ("baseball бейсбол" → ["baseball",
 *  "бейсбол"]); the text whole otherwise. */
export function splitAtCyrillic(text: string): string[] {
  const at = text.search(CYRILLIC);
  return at > 0 && latinLetters(text.slice(0, at)) > 0
    ? [text.slice(0, at).trim(), text.slice(at).trim()]
    : [text];
}
