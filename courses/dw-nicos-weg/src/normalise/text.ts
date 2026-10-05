// Plain text from DW's HTML fields.

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

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X"))
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number(name.slice(1)));
    return NAMED[name] ?? match;
  });
}

/** Text without tags and entities, whitespace collapsed, NFC. */
export function plainText(html: unknown): string {
  return decodeEntities(
    String(html ?? "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[\s ]+/g, " ")
    .trim()
    .normalize("NFC");
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

/** Labels of DW's player that appear in content fields; not content. */
export const isUiLabel = (text: string) =>
  /^(Прослушать аудио|Play audio|Audio abspielen)$/i.test(text);
