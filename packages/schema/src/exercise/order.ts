// order: put parts (words of a sentence, letters of a word, pictures) into sequence.
import { z } from "zod";
import { exerciseOf, ItemBase, Option, OptionId } from "./base.ts";

export const OrderItem = ItemBase.extend({
  parts: z.array(Option).min(2),
  /** How text parts are joined: words with spaces (punctuation attaches), letters without. */
  join: z.enum(["space", "none"]),
  /** Parts with identical text are interchangeable when checking. */
  answer: z.object({ sequence: z.array(OptionId).min(2) }),
});
export const OrderAnswer = z.object({ sequence: z.array(OptionId) });
export const OrderExercise = exerciseOf("order", OrderItem);
export type OrderAnswer = z.infer<typeof OrderAnswer>;
