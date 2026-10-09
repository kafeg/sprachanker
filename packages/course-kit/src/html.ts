// HTML sanitiser for course texts (02, "Conventions": allow-list, images as media paths).
import type { MediaPath } from "@sprachanker/schema";
import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = [
  "h3",
  "p",
  "br",
  "b",
  "strong",
  "i",
  "em",
  "small",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "figure",
  "figcaption",
  "img",
];

export interface SanitizeOptions {
  /** Media path for an image source of the provider (e.g. a URL template); undefined drops the image. */
  image(attributes: Record<string, string>): MediaPath | undefined;
  /** Elements to drop with their content, e.g. credit lines. */
  drop?(tag: string, attributes: Record<string, string>): boolean;
}

/** Keeps the allow-listed elements without attributes (images get `src` and `alt`); unwraps the rest. */
export function sanitizeCourseHtml(html: string, options: SanitizeOptions): string {
  const clean = sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { img: ["src", "alt"] },
    allowedSchemes: [],
    allowedSchemesAppliedToAttributes: [],
    allowProtocolRelative: false,
    transformTags: {
      img: (tagName, attribs): sanitizeHtml.Tag => {
        const src = options.image(attribs);
        return src
          ? { tagName, attribs: { src, alt: attribs.alt ?? "" } }
          : { tagName: "drop-image", attribs: {} as sanitizeHtml.Attributes };
      },
    },
    exclusiveFilter: (frame) =>
      frame.tag === "drop-image" || (options.drop?.(frame.tag, frame.attribs) ?? false),
  });
  return nestedHeadingsAsBold(withoutEmpty(clean)).trim();
}

/** Emphasis around nothing but spaces (an editor's leftover) gives just its spaces; a paragraph,
 *  caption or title left with nothing in it goes (a dropped credit leaves an empty caption). */
function withoutEmpty(html: string): string {
  let out = html;
  for (let prev = ""; prev !== out; ) {
    prev = out;
    out = out
      .replace(/<(strong|b|em|i|small)>(\s*)<\/\1>/g, "$2")
      .replace(/<(p|figcaption|h3)>(?:\s|<br \/>)*<\/\1>/g, "");
  }
  return out;
}

/** An `<h3>` titles a section of the page only outside tables, lists and figures (the app divides a
 *  page at its titles, 09); one inside them is a bold paragraph. */
function nestedHeadingsAsBold(html: string): string {
  let depth = 0;
  return html.replace(/<(\/?)(table|ul|ol|figure|h3)>/g, (tag, close: string, name: string) => {
    if (name !== "h3") {
      depth += close ? -1 : 1;
      return tag;
    }
    if (!depth) return tag;
    return close ? "</strong></p>" : "<p><strong>";
  });
}

/**
 * Sanitised course HTML whose sections are titled by a paragraph of bold text only ("<p><strong>Formal
 * greeting</strong></p>"): those paragraphs become `<h3>` section titles (a trailing colon dropped), so
 * the app can show each section on its own. Other bold text stays as it is.
 */
export function boldLinesAsHeadings(html: string): string {
  const titled = html.replace(
    /<p>\s*<(strong|b)>((?:(?!<\/?(?:strong|b|p)>).)+?)<\/\1>\s*<\/p>/gs,
    (_, _tag, title: string) => `<h3>${title.trim().replace(/\s*:$/, "")}</h3>`,
  );
  return nestedHeadingsAsBold(titled);
}

/** Plain text as HTML text content: `&`, `<` and `>` escaped (quotes stay: not for attributes). */
export const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
