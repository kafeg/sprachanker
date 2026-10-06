// The irregular verbs page (a bonus page) → its table rows.
import { plainText } from "@sprachanker/course-kit";
import { type El, findAll, hasClass, innerHtml, isEl } from "../dom.ts";
import { articleElements } from "./page.ts";

/** The irregular verbs table: infinitive, past, participle, translation. */
export interface VerbRow {
  forms: [string, string, string];
  translation: string;
}

export function parseVerbTable(html: string): { title: string; elements: El[]; rows: VerbRow[] } {
  const { title, els } = articleElements(html);
  const table = els.flatMap((e) =>
    e.tag === "table" ? [e] : findAll(e, (x) => x.tag === "table"),
  )[0];
  const cell = (td: El) =>
    plainText(innerHtml(td, true).replace(/<br\s*\/?>/gi, " / "))
      .replace(/\s*\/\s*(?=\/)/g, " ")
      .replace(/,\s*\//g, ",")
      .trim();
  const rows = table
    ? findAll(table, (e) => e.tag === "tr").flatMap((tr) => {
        const tds = tr.children.filter((c): c is El => isEl(c) && c.tag === "td");
        if (tds.length !== 4 || hasClass(tr, "tac")) return [];
        const [a, b, c, d] = tds.map(cell) as [string, string, string, string];
        return [
          { forms: [a, b, c] as [string, string, string], translation: d.replace(/ \/ /g, ", ") },
        ];
      })
    : [];
  return { title, elements: els, rows };
}
