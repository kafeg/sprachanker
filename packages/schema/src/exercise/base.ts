// Parts shared by all exercise types (02, "Exercise types").
import { z } from "zod";
import { Media, Sha256 } from "../common.ts";
import { ExerciseKey, ItemKey, RuleId, VocabKey } from "../keys.ts";

/** Option id inside an item: `a`, `b`, `c`… in canonical order. */
export const OptionId = z.string().regex(/^[a-z]{1,2}$/);
export type OptionId = z.infer<typeof OptionId>;

/** Gap id inside an item: `g1`, `g2`… in text order. */
export const GapId = z.string().regex(/^g[1-9]\d*$/);
export type GapId = z.infer<typeof GapId>;

/** A choice shown to the learner: target-language text, media, or both. */
export const Option = z
  .object({
    id: OptionId,
    text: z.string().optional(),
    media: Media.optional(),
  })
  .meta({ id: "Option" });
export type Option = z.infer<typeof Option>;

/** Text with gaps: plain strings and `{ gap }` markers, in reading order. */
export const Segments = z
  .array(z.union([z.string(), z.object({ gap: GapId })]))
  .min(1)
  .meta({ id: "Segments" });

export const ItemBase = z.object({
  key: ItemKey,
  media: Media.optional(),
  /** Target-language prompt or context line; a learner-language one lives in the locale file. */
  prompt: z.string().optional(),
});

export const exerciseOf = <const T extends string, I extends z.ZodType>(type: T, item: I) =>
  z
    .object({
      key: ExerciseKey,
      type: z.literal(type),
      /** sha256 of the JCS of this object without `fingerprint` (course-kit computes it). */
      fingerprint: Sha256,
      /** Stimulus for the whole exercise (episode video, picture, audio). */
      media: Media.optional(),
      /** Target-language stimulus text. */
      text: z.string().optional(),
      newWords: z.array(VocabKey),
      ruleIds: z.array(RuleId),
      items: z.array(item).min(1),
    })
    .meta({ id: `${type}_exercise` });
