import { z } from "zod";
import { MultiChoiceExercise, SingleChoiceExercise } from "./choice.ts";
import { GapChoiceExercise, GapTextExercise } from "./gap.ts";
import { MatchExercise } from "./match.ts";
import { OrderExercise } from "./order.ts";
import { UnknownExercise } from "./other.ts";
import { RespondExercise } from "./respond.ts";
import { DictationExercise, SpeechRepeatExercise, SpeechSelfrateExercise } from "./speech.ts";

// What other modules use: the exercise union, options and ids, stored answers and outcomes. Each
// type's item and exercise schema stays inside (`ItemOf` types an item).
export { GapId, Option, OptionId } from "./base.ts";
export { MultiChoiceAnswer, SingleChoiceAnswer } from "./choice.ts";
export { correctOptions, GapChoiceAnswer, GapTextAnswer } from "./gap.ts";
export { MatchAnswer } from "./match.ts";
export { joinParts, OrderAnswer, partsAreSentences } from "./order.ts";
export { Outcome, TokenDiff } from "./outcome.ts";
export { RespondAnswer } from "./respond.ts";
export {
  DictationAnswer,
  recordingOf,
  SpeechRepeatAnswer,
  SpeechSelfrateAnswer,
} from "./speech.ts";

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
type ExerciseType = Exercise["type"];
/** An item of an exercise of one type. */
export type ItemOf<T extends ExerciseType> = Extract<Exercise, { type: T }>["items"][number];
export const EXERCISE_TYPES = Exercise.options.map((o) => o.shape.type.value);
