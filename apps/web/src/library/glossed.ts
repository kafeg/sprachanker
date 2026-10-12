// A line of an Understanding text with its glossed words marked: the words its glossary
// translates, found whole in the line in any case, each with its translation. Pure.

export interface Gloss {
  word: string;
  translation: string;
}

/** Runs of the line in order: plain text, and the glossed words with their translations. */
export function glossed(line: string, glossary: Gloss[]): Array<{ text: string; gloss?: string }> {
  const words = glossary.filter((g) => g.word.trim()).sort((a, b) => b.word.length - a.word.length);
  if (!words.length) return [{ text: line }];
  const escaped = words.map((g) => g.word.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${escaped.join("|")})(?![\\p{L}\\p{N}])`,
    "giu",
  );
  const out: Array<{ text: string; gloss?: string }> = [];
  let from = 0;
  for (const m of line.matchAll(pattern)) {
    if (m.index > from) out.push({ text: line.slice(from, m.index) });
    const gloss = words.find((g) => g.word.trim().toLowerCase() === m[0].toLowerCase());
    out.push({ text: m[0], gloss: gloss?.translation });
    from = m.index + m[0].length;
  }
  if (from < line.length) out.push({ text: line.slice(from) });
  return out;
}
