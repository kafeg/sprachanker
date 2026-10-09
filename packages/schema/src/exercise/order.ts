// order: put parts (words of a sentence, letters of a word, pictures) into sequence.
import { z } from "zod";
import { exerciseOf, ItemBase, Option, OptionId } from "./base.ts";

export const OrderItem = ItemBase.extend({
  parts: z.array(Option).min(2),
  /** How text parts are joined: words with spaces (punctuation attaches), letters without. */
  join: z.enum(["space", "none"]),
  /** Parts with identical text are interchangeable when checking. */
  answer: z.strictObject({ sequence: z.array(OptionId).min(2) }),
});
export const OrderAnswer = z.strictObject({ sequence: z.array(OptionId) });
export const OrderExercise = exerciseOf("order", OrderItem);
export type OrderAnswer = z.infer<typeof OrderAnswer>;

/** Ordered parts as text: words with spaces (punctuation attached), letters (`join: "none"`) without. */
export const joinParts = (texts: Array<string | undefined>, join: "space" | "none") =>
  join === "none" ? texts.join("") : texts.join(" ").replace(/ ([.,!?;:])/g, "$1");
