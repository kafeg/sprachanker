// respond: open answer (translation, short writing, answering a prompt), written or spoken.
import { z } from "zod";
import { exerciseOf, ItemBase } from "./base.ts";
import { SpokenAnswer } from "./speech.ts";

const RubricId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const RespondItem = ItemBase.extend({
  input: z.enum(["text", "speech"]),
  rubric: z
    .object({
      /** Groups of which the answer must contain at least one variant. */
      required: z.array(z.strictObject({ id: RubricId, anyOf: z.array(z.string().min(1)).min(1) })),
      /** Criteria judged by the LLM; their texts live in the locale file. */
      criteria: z.array(z.strictObject({ id: RubricId })),
    })
    .optional(),
  /** Model answers in the target language; a translation into the learner's language has its model
   *  answers in the locale item (`reference`) instead. */
  reference: z.array(z.string().min(1)),
  /** The language the answer is written in: the target (default) or the learner's (a translation). */
  answerIn: z.enum(["target", "learner"]).optional(),
});
export const RespondAnswer = z.strictObject({ text: z.string(), speech: SpokenAnswer.optional() });
export const RespondExercise = exerciseOf("respond", RespondItem);
export type RespondAnswer = z.infer<typeof RespondAnswer>;
