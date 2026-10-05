// Course HTML → plain text for prompts.
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|h\d|li|tr|table|ul|ol|figure)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e.startsWith("#x")) return String.fromCodePoint(Number.parseInt(e.slice(2), 16));
      if (e.startsWith("#")) return String.fromCodePoint(Number(e.slice(1)));
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

/** The most recent conversation turns that fit `budget` characters, oldest first, as chat messages. */
export function recentTurns(
  history: Array<{ role: "user" | "assistant"; text: string }>,
  budget: number,
): Array<{ role: "user" | "assistant"; content: string }> {
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  let size = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i] as (typeof history)[number];
    if (size + turn.text.length > budget) break;
    out.unshift({ role: turn.role, content: turn.text });
    size += turn.text.length;
  }
  return out;
}
