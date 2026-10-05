import { z } from "zod";

/** BCP-47 primary language subtag: `de`, `en`, `ru`. */
export const Lang = z
  .string()
  .regex(/^[a-z]{2,3}$/)
  .describe("BCP-47 primary language subtag");
export type Lang = z.infer<typeof Lang>;

/** Edition id `<source>-<target>`: `ru-de`, `en-de`, `de-de` (02). */
export const EditionId = z
  .string()
  .regex(/^[a-z]{2,3}-[a-z]{2,3}$/)
  .describe("Edition id <source>-<target>");
export type EditionId = z.infer<typeof EditionId>;

export function editionId(source: Lang, target: Lang): EditionId {
  return EditionId.parse(`${source}-${target}`);
}

export function parseEditionId(id: EditionId): { source: Lang; target: Lang } {
  const [source = "", target = ""] = id.split("-");
  return { source, target };
}
