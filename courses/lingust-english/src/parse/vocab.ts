// A lesson's vocabulary ("Словарь"): rows of headword, transcription, marks, forms and translation.
import { type El, findAll, innerHtml, plainText } from "@sprachanker/course-kit";
import { ipaOf, withoutIpa } from "../text.ts";

export interface VocabRow {
  head: string;
  ipa?: string;
  translation: string;
  /** Part-of-speech marks of the source ("v.", "adj", "n."). */
  marks: string[];
  /** Past and participle as the source lists them ("прош. chose; прич. chosen"). */
  forms: string[];
}

/** Vocabulary rows of the elements under the vocabulary heading. */
export function vocabRows(els: El[]): VocabRow[] {
  const cols = els.flatMap((el) => findAll(el, (e) => /\bcol-/.test(e.attrs.class ?? "")));
  return cols.flatMap((col) =>
    innerHtml(col, true)
      .split(/<br\s*\/?>/i)
      .flatMap((entry) => {
        const head = /<strong>([\s\S]*?)<\/strong>/.exec(entry);
        if (!head) return [];
        const after = entry.slice((head.index ?? 0) + head[0].length);
        const rest = plainText(after);
        // The transcription right after the headword ("/bed/" has no IPA marks to recognise).
        const lead = /^\/[^/]+\//.exec(rest)?.[0];
        const ipa = lead ?? ipaOf(` ${rest}`);
        const marks = [...after.matchAll(/<em>\s*(v|adj|n|adv)\.?\s*<\/em>/g)].map(
          (m) => m[1] as string,
        );
        const forms = /прош/.test(after)
          ? [...after.matchAll(/(?:прош|прич)[^<]*<\/em>\s*<strong>([^<]+)<\/strong>/g)].map((m) =>
              plainText(m[1]),
            )
          : [];
        const translation = withoutIpa(` ${lead ? rest.slice(lead.length) : rest}`).replace(
          /^[\s=]+/,
          "",
        );
        return [
          {
            head: plainText(head[1]),
            ...(ipa ? { ipa } : {}),
            translation,
            marks,
            forms,
          },
        ];
      }),
  );
}
