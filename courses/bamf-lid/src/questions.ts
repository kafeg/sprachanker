// The catalogue PDF's text and pictures read as questions (pure): "Teil I — Allgemeine Fragen" (Aufgabe
// 1–300), then "Fragen für das Bundesland …" (Aufgabe 1–10 each); a question's stem, its four options
// (each after a box), its pictures — four in a row as the options ("Bild 1" … "Bild 4"), or one the
// stem refers to — and the credits printed under them.
import type { PdfImage, PdfLine } from "./pdf.ts";

export interface CatalogueQuestion {
  /** `null`: the general part; else the federal state's name as the PDF heads its section. */
  state: string | null;
  number: number;
  stem: string;
  options: string[];
  /** In reading order: a row of four is the options' pictures, left to right. */
  pictures: PdfImage[];
  /** What is printed under the pictures: credits ("© …"), a source ("In Anlehnung an …"). */
  credit?: string;
}

export interface Catalogue {
  /** The date on the first page ("Stand: 07.05.2025"), as `YYYY-MM-DD`. */
  stand: string;
  questions: CatalogueQuestion[];
}

/** The boxes before the options (a Wingdings glyph, a few drawn as "□"). */
const BOX = /^[□]\s*/;
const FOOTER = /^Seite \d+ von \d+$/;
/** The parts' headings ("Teil I", "Teil II") above their sections. */
const PART = /^Teil [IV]+$/;
const QUESTION = /^Aufgabe (\d+)$/;
const STATE = /^Fragen für das Bundesland (.+)$/;
const LABELS = /^Bild \d(?:\s+Bild \d)*$/;
const STAND = /Stand:\s*(\d{2})\.(\d{2})\.(\d{4})/;
/** The page head (BAMF's logo) stands above the text area. */
const TEXT_TOP = 700;

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

interface Parsed extends CatalogueQuestion {
  page: number;
  y: number;
  /** The lines before the options: the stem, then what is printed with its pictures. */
  before: PdfLine[];
}

export function parseCatalogue(lines: PdfLine[], images: PdfImage[]): Catalogue {
  const stand = lines.map((l) => STAND.exec(l.text)).find(Boolean);
  if (!stand) throw new Error("the catalogue has no date (Stand: …) on its first page");
  const questions: Parsed[] = [];
  let state: string | null | undefined;
  let current: Parsed | undefined;
  for (const line of lines) {
    const text = clean(line.text);
    if (!text || FOOTER.test(text) || PART.test(text)) continue;
    const section = text === "Allgemeine Fragen" ? null : STATE.exec(text)?.[1];
    if (section !== undefined) {
      state = section;
      current = undefined;
      continue;
    }
    const heading = QUESTION.exec(text);
    if (heading && state !== undefined) {
      current = {
        state,
        number: Number(heading[1]),
        stem: "",
        options: [],
        pictures: [],
        page: line.page,
        y: line.y,
        before: [],
      };
      questions.push(current);
      continue;
    }
    if (!current) continue;
    if (BOX.test(line.text.trimStart())) {
      current.options.push(clean(line.text.trimStart().replace(BOX, "")));
      continue;
    }
    // A line after an option: the option goes on (a long one wraps).
    if (current.options.length) {
      const last = current.options.length - 1;
      current.options[last] = clean(`${current.options[last]} ${text}`);
      continue;
    }
    if (!LABELS.test(text)) current.before.push(line);
  }

  // Pictures: each under the last question heading above it on its page.
  for (const image of images) {
    if (image.y >= TEXT_TOP) continue;
    const top = image.y + image.height;
    const owner = questions.filter((q) => q.page === image.page && q.y > top).at(-1);
    owner?.pictures.push(image);
  }
  return {
    stand: `${stand[3]}-${stand[2]}-${stand[1]}`,
    questions: questions.map(({ page, y: _, before, ...q }) => {
      // Left to right in a row (a row of four reads as Bild 1 … Bild 4), rows top to bottom.
      const pictures = q.pictures.sort((a, b) =>
        a.y < b.y + b.height && b.y < a.y + a.height ? a.x - b.x : b.y - a.y,
      );
      // What stands below the pictures' top edge is printed with them, not part of the stem.
      const top = Math.max(...pictures.map((p) => p.y + p.height));
      const stemLines = before.filter((l) => !pictures.length || l.page !== page || l.y > top);
      const captions = before.filter((l) => !stemLines.includes(l));
      const stem = clean(stemLines.map((l) => l.text).join(" ")).replace(
        new RegExp(`^${q.number}\\.\\s+`),
        "",
      );
      const credit = clean(captions.map((l) => l.text).join(" "));
      return { ...q, stem, pictures, ...(credit && { credit }) };
    }),
  };
}
