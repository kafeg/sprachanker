import { z } from "zod";
import { MultiChoiceExercise, SingleChoiceExercise } from "./choice.ts";
import { GapChoiceExercise, GapTextExercise } from "./gap.ts";
import { MatchExercise } from "./match.ts";
import { OrderExercise } from "./order.ts";
import { UnknownExercise } from "./other.ts";
import { RespondExercise } from "./respond.ts";
import { DictationExercise, SpeechRepeatExercise, SpeechSelfrateExercise } from "./speech.ts";

export * from "./base.ts";
export * from "./choice.ts";
export * from "./gap.ts";
export * from "./match.ts";
export * from "./order.ts";
export * from "./other.ts";
export * from "./outcome.ts";
export * from "./respond.ts";
export * from "./speech.ts";

/** Every exercise type (02); adding one needs a checker, a renderer and a fixture item (root rule 2). */
export const Exercise = z.discriminatedUnion("type", [
  SingleChoiceExercise,
  MultiChoiceExercise,
  MatchExercise,
  OrderExercise,
  GapChoiceExercise,
  GapTextExercise,
  DictationExercise,
  SpeechRepeatExercise,
  SpeechSelfrateExercise,
  RespondExercise,
  UnknownExercise,
]);
export type Exercise = z.infer<typeof Exercise>;
export type ExerciseType = Exercise["type"];
/** An item of an exercise of one type. */
export type ItemOf<T extends ExerciseType> = Extract<Exercise, { type: T }>["items"][number];
export const EXERCISE_TYPES = Exercise.options.map((o) => o.shape.type.value);
