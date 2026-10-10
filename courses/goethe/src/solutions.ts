// A Teil's solution page (`hoeren_l1.php`, …; research exams.md): its answers by question number, as
// a list ("1 … Lösung: Neunzehn Euro fünfundneunzig Cent.") or, for answers typed, a table (number,
// the candidate's answer, the right one, points). An answer is text as the page gives it; matching
// it to an option is normalise.ts's.
import { type El, findAll, isEl, parseHtml } from "@sprachanker/course-kit";
import { textOf } from "./page.ts";

export interface Solution {
  number: number;
  /** The right answer as written, and its alternatives ("4 / vier"). */
  answers: string[];
}

const elements = (root: El, tag: string): El[] => findAll(root, (e) => e.tag === tag);

export function readSolutions(html: string): Solution[] {
  const root = parseHtml(html);
  const out: Solution[] = [];
  // The list form: an item per question, its number in <strong>, the answer after "Lösung:".
  for (const li of elements(root, "li")) {
    const text = textOf(li);
    const answer = /Lösung:\s*(.*?)\s*(?:Ihre Auswahl:|$)/.exec(text)?.[1];
    const number = /^\s*(\d+)/.exec(textOf(elements(li, "strong")[0] ?? li))?.[1];
    if (answer !== undefined && number) out.push({ number: Number(number), answers: [answer] });
  }
  if (out.length) return out;
  // The table form: a row per question — its number, the candidate's answer, the right one.
  for (const tr of elements(root, "tr")) {
    const cells = tr.children.filter((c): c is El => isEl(c) && (c.tag === "th" || c.tag === "td"));
    const number = /^\s*(\d+)\s*$/.exec(textOf(cells[0] ?? tr))?.[1];
    const right = cells[2] ? textOf(cells[2]) : "";
    if (number && right)
      out.push({
        number: Number(number),
        answers: right
          .split(/\s+\/\s+/)
          .map((a) => a.trim())
          .filter(Boolean),
      });
  }
  return out;
}
