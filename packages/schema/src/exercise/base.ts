// Parts shared by all exercise types.
import { z } from "zod";
import { Media, MediaPath, Sha256 } from "../common.ts";
import { ExerciseKey, ItemKey, RuleId, VocabKey } from "../keys.ts";

/** Option id inside an item: `a`, `b`, `c`… in canonical order. */
export const OptionId = z.string().regex(/^[a-z]{1,2}$/);
export type OptionId = z.infer<typeof OptionId>;

/** Gap id inside an item: `g1`, `g2`… in text order. */
export const GapId = z.string().regex(/^g[1-9]\d*$/);
export type GapId = z.infer<typeof GapId>;

/** A choice shown to the learner: target-language text, media, or both. */
export const Option = z
  .strictObject({
    id: OptionId,
    text: z.string().optional(),
    media: Media.optional(),
  })
  .meta({ id: "Option" });
export type Option = z.infer<typeof Option>;

/** Text with gaps: plain strings and `{ gap }` markers, in reading order. */
export const Segments = z
  .array(z.union([z.string(), z.strictObject({ gap: GapId })]))
  .min(1)
  .meta({ id: "Segments" });

export const ItemBase = z.strictObject({
  key: ItemKey,
  /** What the item asks with: its recording is heard before it is answered. */
  media: Media.optional(),
  /** The source's own answer, spoken (DW's "Lösungsaudio"): heard once the item is checked — before,
   *  it would give the answer away. */
  answerAudio: MediaPath.optional(),
  /** Target-language prompt or context line; a learner-language one lives in the locale file. */
  prompt: z.string().optional(),
});

export const exerciseOf = <const T extends string, I extends z.ZodType>(type: T, item: I) =>
  z
    .strictObject({
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
    // Items are addressed by position (`#n`): an item's key says where it is.
    .refine((e) => e.items.every((it, i) => (it as { key?: string }).key === `${e.key}#${i + 1}`), {
      message: "item keys must be <exercise key>#<position>",
      path: ["items"],
    })
    .meta({ id: `${type}_exercise` });
