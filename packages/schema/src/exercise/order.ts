// order: put parts (words of a sentence, letters of a word, pictures) into sequence.
import { z } from "zod";
import { exerciseOf, ItemBase, Option, OptionId } from "./base.ts";

const OrderItem = ItemBase.extend({
  parts: z.array(Option).min(2),
  /** How text parts are joined: words with spaces (punctuation attaches), letters without. */
  join: z.enum(["space", "none"]),
  /** Parts with identical text are interchangeable when checking. */
  answer: z.strictObject({ sequence: z.array(OptionId).min(2) }),
});
export const OrderAnswer = z.strictObject({ sequence: z.array(OptionId) });
export const OrderExercise = exerciseOf("order", OrderItem);
export type OrderAnswer = z.infer<typeof OrderAnswer>;

/** Parts that are whole sentences (two or more, each of words ending in . ! ?), not one sentence's
 *  words or clauses: read as a numbered list, never run together. */
export const partsAreSentences = (texts: Array<string | undefined>) =>
  texts.filter((t) => !!t && /\p{L}.*\s.*[.!?…]["»“”]?$/u.test(t.trim())).length >= 2;

/** Ordered parts as text: words with spaces (punctuation attached), letters (`join: "none"`) without. */
export const joinParts = (texts: Array<string | undefined>, join: "space" | "none") =>
  join === "none" ? texts.join("") : texts.join(" ").replace(/ ([.,!?;:])/g, "$1");
