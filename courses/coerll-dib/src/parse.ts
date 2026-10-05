// The site's pages → data (HTML from 2017; plain tag patterns, no client scripts needed).
import { plainText } from "@sprachanker/course-kit";

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
    ].map((m) => plainText(m[1]));
    const audio = /<source src="(https:[^"]+\.mp3)"/.exec(block)?.[1];
    const rows: VocabRow[] = [];
    for (const m of block.matchAll(
      /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/g,
    )) {
      const de = plainText(m[1]);
      const en = plainText(m[2]);
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
  return { title: plainText(alt), ...(pdf ? { pdf } : {}) };
}
