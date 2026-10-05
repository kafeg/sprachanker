// order: put parts (words of a sentence, letters of a word) into sequence.
import { z } from "zod";
import { exerciseOf, ItemBase, OptionId } from "./base.ts";

export const OrderItem = ItemBase.extend({
  parts: z.array(z.object({ id: OptionId, text: z.string().min(1) })).min(2),
  /** How the ordered parts are joined: words with spaces, letters without. */
  join: z.enum(["space", "none"]),
  /** Parts with identical text are interchangeable when checking. */
  answer: z.object({ sequence: z.array(OptionId).min(2) }),
});
export const OrderAnswer = z.object({ sequence: z.array(OptionId) });
export const OrderExercise = exerciseOf("order", OrderItem);
