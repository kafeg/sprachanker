// match: pair every left entry with a right entry.
import { z } from "zod";
import { exerciseOf, ItemBase, Option, OptionId } from "./base.ts";

const Pair = z.tuple([OptionId, OptionId]);

const MatchItem = ItemBase.extend({
  left: z.array(Option).min(2),
  right: z.array(Option).min(2),
  answer: z.strictObject({ pairs: z.array(Pair).min(1) }),
});
export const MatchAnswer = z.strictObject({ pairs: z.array(Pair) });
export const MatchExercise = exerciseOf("match", MatchItem);
export type MatchAnswer = z.infer<typeof MatchAnswer>;
