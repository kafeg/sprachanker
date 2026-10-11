// Where a course's text may break and where not (09, "Line breaks"): shown so only, the data unchanged.

/**
 * No break where a lone piece would be left — an ellipsis stays with the word before it ("vielleicht,
 * …?"), a number with its short unit ("2 km"), a hyphen with the word part it opens or ends ("-symbole",
 * "(e)te-") —, and a break allowed after a slash between words ("Führerschein/Computerkenntnisse").
 * Pure.
 */
export const keptTogether = (text: string) =>
  text
    .replace(/(?<=\S)[ \t]+(?=\.\.\.|…)/g, " ")
    .replace(/(?<=\d) (?=(?:\p{L}{1,3}|[%°€$])(?!\p{L}))/gu, " ")
    .replace(/(?<=^|[\s(„"«])-(?=[\p{L}(])/gu, "‑")
    .replace(/(?<=[\p{L})])-(?=$|[\s.,;:!?)“"»])/gu, "‑")
    .replace(/(?<=\p{L})\/(?=\p{L})/gu, "/​");

/** `keptTogether` over the text of HTML, its tags untouched. Pure. */
export const keptTogetherHtml = (html: string) =>
  html
    .split(/(<[^>]*>)/)
    .map((part) => (part.startsWith("<") ? part : keptTogether(part)))
    .join("");
