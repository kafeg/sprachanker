// respond: open answer (translation, short writing, answering a prompt), written or spoken.
import { z } from "zod";
import { Slug } from "../keys.ts";
import { exerciseOf, ItemBase } from "./base.ts";
import { SpokenAnswer } from "./speech.ts";

export const RespondItem = ItemBase.extend({
  input: z.enum(["text", "speech"]),
  rubric: z
    .strictObject({
      /** Groups of which the answer must contain at least one variant. */
      required: z.array(z.strictObject({ id: Slug, anyOf: z.array(z.string().min(1)).min(1) })),
    })
    .optional(),
  /** Model answers in the target language; a translation into the learner's language has its model
   *  answers in the locale item (`reference`) instead. */
  reference: z.array(z.string().min(1)),
  /** The language the answer is written in: the target (default) or the learner's (a translation). */
  answerIn: z.enum(["target", "learner"]).optional(),
});
export const RespondAnswer = z.strictObject({
  text: z.string(),
  speech: SpokenAnswer.optional(),
  /** An exam's speaking part said line by line from its script: each of the learner's lines as heard,
   *  with its take; `text` holds them joined, a line each. */
  lines: z.array(SpokenAnswer).max(40).optional(),
});
export const RespondExercise = exerciseOf("respond", RespondItem);
export type RespondAnswer = z.infer<typeof RespondAnswer>;
