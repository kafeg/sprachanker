// gap_choice and gap_text: fill gaps in a text.
import { z } from "zod";
import { exerciseOf, GapId, ItemBase, Option, OptionId, Segments } from "./base.ts";

const GapChoiceItem = ItemBase.extend({
  segments: Segments,
  gaps: z.record(GapId, z.strictObject({ options: z.array(Option).min(1) })),
  /** `bank`: one shared word bank, each word used once; `dropdown`: options per gap. */
  display: z.enum(["dropdown", "bank"]),
  /** The correct option of each gap, or several when any of them is right. */
  answer: z.record(GapId, z.union([OptionId, z.array(OptionId).min(1)])),
});
export const GapChoiceAnswer = z.record(GapId, OptionId);

/** The correct options of a gap as a list (an answer names one or several). */
export const correctOptions = (want: OptionId | OptionId[] | undefined): OptionId[] =>
  want === undefined ? [] : Array.isArray(want) ? want : [want];

export const GapChoiceExercise = exerciseOf("gap_choice", GapChoiceItem);

export const GapTextItem = ItemBase.extend({
  segments: Segments,
  /** Accepted texts per gap; "" means nothing belongs there (no article), and an empty or dash
   *  answer is then right. */
  answer: z.record(GapId, z.strictObject({ accepted: z.array(z.string()).min(1) })),
});
export const GapTextAnswer = z.record(GapId, z.string());
export const GapTextExercise = exerciseOf("gap_text", GapTextItem);
export type GapChoiceAnswer = z.infer<typeof GapChoiceAnswer>;
export type GapTextAnswer = z.infer<typeof GapTextAnswer>;
