// Part of speech, gender and forms from a DW vocabulary headword (02, research "Vocabulary").
import { type Headword, shapeHeadword } from "@sprachanker/course-kit";
import type { Gender } from "@sprachanker/schema";

const ARTICLE = /^\(?(der|die|das)\)?\s+(.+)$/;
const GENDER: Record<string, Gender> = { der: "m", die: "f", das: "n" };
const VERB_FORMS = /^[^,]+, [^,]+, (hat|ist) \S.*$/;
const COMPARISON = /\bam \S+sten\b/;

/** Removes parenthesised parts and returns them separately: "(etwas) studieren" → studieren, [etwas]. */
function splitParens(text: string): { rest: string; parens: string[] } {
  const parens: string[] = [];
  const rest = text.replace(/\s*\(([^)]*)\)\s*/g, (_, inner: string) => {
    parens.push(inner.trim());
    return " ";
  });
  return { rest: rest.replace(/\s+/g, " ").trim(), parens };
}

export function parseHeadword(name: string, subTitle: string): Headword {
  const sub = subTitle.trim();
  const [head = "", ...pluralParts] = name.split(",");
  const article = ARTICLE.exec(head.trim());
  if (article) {
    const { rest, parens } = splitParens(article[2] as string);
    const pluralOnly = /\(Plural\)/.test(name);
    const plural = splitParens(pluralParts.join(",")).rest || undefined;
    const notes = [
      ...parens.filter((p) => p !== "Plural"),
      ...splitParens(pluralParts.join(",")).parens,
      sub,
    ].filter(Boolean);
    return {
      lemma: rest,
      pos: "noun",
      gender: pluralOnly ? "pl" : GENDER[article[1] as string],
      ...(plural ? { plural } : {}),
      ...(notes.length ? { note: notes.join("; ") } : {}),
    };
  }
  const { rest } = splitParens(name);
  if (VERB_FORMS.test(sub)) return { lemma: rest, pos: "verb", forms: sub };
  if (COMPARISON.test(sub)) return { lemma: rest, pos: "adj", forms: sub };
  return { ...shapeHeadword("de", rest), ...(sub ? { note: sub } : {}) };
}
