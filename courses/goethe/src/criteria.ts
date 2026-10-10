// The criteria an open answer is rated by (Schreiben, Sprechen): each one's points by level in the
// exam, its title and what each level means in the locale.
import type { ExamItem, LocaleItem } from "@sprachanker/schema";

/** A criterion's id from its title ("Kommunikative Gestaltung des Textes" → "kommunikative-…"). */
export const criterionId = (title: string) =>
  title
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** An item's criteria as they are read, one by one. */
export function rubric() {
  const criteria: NonNullable<ExamItem["criteria"]> = [];
  const named: NonNullable<LocaleItem["criteria"]> = {};
  return {
    criteria,
    named,
    /** A criterion: its points by level, whether an E voids the answer, what each level means. */
    add(id: string, title: string, points: number[], voids: boolean, texts: string[] = []) {
      criteria.push({ id, levels: points, ...(voids && { voids: true }) });
      named[id] = { title, ...(texts.some(Boolean) && { levels: texts }) };
    },
  };
}
