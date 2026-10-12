import { z } from "zod";

/** BCP-47 primary language subtag: `de`, `en`, `ru`. */
export const Lang = z
  .string()
  .regex(/^[a-z]{2,3}$/)
  .describe("BCP-47 primary language subtag");
export type Lang = z.infer<typeof Lang>;

/** Edition id `<source>-<target>`: `ru-de`, `en-de`, `de-de`. */
export const EditionId = z
  .string()
  .regex(/^[a-z]{2,3}-[a-z]{2,3}$/)
  .describe("Edition id <source>-<target>");
export type EditionId = z.infer<typeof EditionId>;

export function parseEditionId(id: EditionId): { source: Lang; target: Lang } {
  const [source = "", target = ""] = id.split("-");
  return { source, target };
}

/** Languages written right to left, for where Intl cannot tell (no `Intl.Locale` text info). */
const RIGHT_TO_LEFT: ReadonlySet<string> = new Set([
  "ar",
  "fa",
  "he",
  "ur",
  "ps",
  "sd",
  "yi",
  "dv",
  "ckb",
  "ug",
]);

/** The direction a language is written in: from Intl where it knows, else `RIGHT_TO_LEFT`. */
export function languageDir(code: string): "ltr" | "rtl" {
  try {
    const locale = new Intl.Locale(code) as Intl.Locale & {
      getTextInfo?(): { direction?: string };
      textInfo?: { direction?: string };
    };
    const direction = (locale.getTextInfo?.() ?? locale.textInfo)?.direction;
    if (direction === "ltr" || direction === "rtl") return direction;
  } catch {
    // Not a language tag: the list.
  }
  return RIGHT_TO_LEFT.has(code.split("-")[0] ?? "") ? "rtl" : "ltr";
}
