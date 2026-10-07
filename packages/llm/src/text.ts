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
