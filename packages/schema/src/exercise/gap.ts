// gap_choice and gap_text: fill gaps in a text.
import { z } from "zod";
import { exerciseOf, GapId, ItemBase, Option, OptionId, Segments } from "./base.ts";

export const GapChoiceItem = ItemBase.extend({
  segments: Segments,
  gaps: z.record(GapId, z.object({ options: z.array(Option).min(1) })),
  /** `bank`: one shared word bank, each word used once; `dropdown`: options per gap. */
  display: z.enum(["dropdown", "bank"]),
  answer: z.record(GapId, OptionId),
});
export const GapChoiceAnswer = z.record(GapId, OptionId);
export const GapChoiceExercise = exerciseOf("gap_choice", GapChoiceItem);

export const GapTextItem = ItemBase.extend({
  segments: Segments,
  answer: z.record(GapId, z.object({ accepted: z.array(z.string().min(1)).min(1) })),
});
export const GapTextAnswer = z.record(GapId, z.string());
export const GapTextExercise = exerciseOf("gap_text", GapTextItem);
