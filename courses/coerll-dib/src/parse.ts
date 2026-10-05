// The site's pages → data (HTML from 2017; plain tag patterns, no client scripts needed).

export interface VocabRow {
  de: string;
  en: string;
}

export interface VocabSection {
  /** 1-based section number of the chapter. */
  n: number;
  titleDe: string;
  titleEn: string;
  /** The section read aloud. */
  audio?: string;
  rows: VocabRow[];
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  nbsp: " ",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  szlig: "ß",
  eacute: "é",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  bdquo: "„",
  ndash: "–",
  mdash: "—",
  hellip: "…",
};

/** Text of an HTML fragment: tags dropped, entities decoded, spaces collapsed. */
export function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e.startsWith("#x")) return String.fromCodePoint(Number.parseInt(e.slice(2), 16));
      if (e.startsWith("#")) return String.fromCodePoint(Number(e.slice(1)));
      return ENTITIES[e] ?? m;
    })
    .replace(/[\s ]+/g, " ")
    .trim()
    .normalize("NFC");
}

/** `voc.php?k=<n>`: every vocabulary section of the chapter, in order. */
export function parseVocabulary(html: string): VocabSection[] {
  const blocks = html.split(/<!-- Vokabular: Kap \d+, section (\d+): vs_\d+ -->/);
  const sections: VocabSection[] = [];
  // split() with a capture group: [before, n1, block1, n2, block2, …]
  for (let i = 1; i < blocks.length; i += 2) {
    const n = Number(blocks[i]);
    const block = blocks[i + 1] ?? "";
    const title = /<div class="voc_sec[^"]*">([\s\S]*?)<\/div>/.exec(block)?.[1] ?? "";
    const [titleDe = "", titleEn = ""] = [
      ...title.matchAll(/<span class="hi_[^"]*">([\s\S]*?)<\/span>/g),
    ].map((m) => text(m[1] ?? ""));
    const audio = /<source src="(https:[^"]+\.mp3)"/.exec(block)?.[1];
    const rows: VocabRow[] = [];
    for (const m of block.matchAll(
      /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/g,
    )) {
      const de = text(m[1] ?? "");
      const en = text(m[2] ?? "");
      if (de && en) rows.push({ de, en });
    }
    sections.push({ n, titleDe, titleEn, ...(audio ? { audio } : {}), rows });
  }
  return sections;
}

/** `toc.php?k=<n>`: the chapter's title ("Willkommen in Würzburg!") and its textbook PDF. */
export function parseChapter(html: string): { title: string; pdf?: string } {
  const alt = /alt="Kapitel [^:"]+: ([^"]+)"/.exec(html)?.[1];
  const pdf = /href="(pdfs\/k_\d+\.pdf)"/.exec(html)?.[1];
  return { title: text(alt ?? ""), ...(pdf ? { pdf } : {}) };
}
