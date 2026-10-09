// single_choice and multi_choice: pick option ids.
import { z } from "zod";
import { exerciseOf, ItemBase, Option, OptionId } from "./base.ts";

export const SingleChoiceItem = ItemBase.extend({
  options: z.array(Option).min(2),
  answer: z.strictObject({ optionIds: z.array(OptionId).length(1) }),
});
export const SingleChoiceAnswer = z.strictObject({ optionId: OptionId });
export const SingleChoiceExercise = exerciseOf("single_choice", SingleChoiceItem);

export const MultiChoiceItem = ItemBase.extend({
  options: z.array(Option).min(2),
  answer: z.strictObject({ optionIds: z.array(OptionId).min(1) }),
});
export const MultiChoiceAnswer = z.strictObject({ optionIds: z.array(OptionId) });
export const MultiChoiceExercise = exerciseOf("multi_choice", MultiChoiceItem);
export type SingleChoiceAnswer = z.infer<typeof SingleChoiceAnswer>;
export type MultiChoiceAnswer = z.infer<typeof MultiChoiceAnswer>;
