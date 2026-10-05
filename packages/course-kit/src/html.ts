// HTML sanitiser for course texts (02, "Conventions": allow-list, images as media paths).
import type { MediaPath } from "@sprachanker/schema";
import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = [
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
  return sanitizeHtml(html, {
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
  })
    .replace(/<p>\s*<\/p>/g, "")
    .trim();
}
