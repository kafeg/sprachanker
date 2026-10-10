// What the player asks of an item's answer before it checks it (04, "Checking"; 09): whether the
// exercise is checked at all, whether an answer is complete enough to check, and what was heard of an
// answer said aloud with no phrase to say. Pure: the web's player and the Notebook read these.
import type {
  Exercise,
  GapChoiceAnswer,
  GapTextAnswer,
  ItemOf,
  MatchAnswer,
  MultiChoiceAnswer,
  OrderAnswer,
  SingleChoiceAnswer,
  SpeechRepeatAnswer,
} from "@sprachanker/schema";

/** Whether the player checks an exercise (marks its items, or shows a model answer): everything but
 *  speaking oneself and exercises of an unknown mechanic. A checked item need not be scored
 *  (`itemScored`: a free answer without a rubric shows its model answer only). */
export const isChecked = (type: Exercise["type"]) =>
  type !== "speech_selfrate" && type !== "unknown";

const gapsOf = (segments: Array<string | { gap: string }>) =>
  segments.flatMap((s) => (typeof s === "string" ? [] : [s.gap]));

/**
 * Whether an item's answer is complete enough to check: every option, pair, part or gap chosen; text
 * typed. Typed gaps need one gap filled, since a gap may rightly stay empty ("no article").
 */
export function answerComplete(exercise: Exercise, index: number, answer: unknown): boolean {
  if (answer === undefined) return false;
  const item = exercise.items[index];
  switch (exercise.type) {
    case "single_choice":
      return !!(answer as SingleChoiceAnswer).optionId;
    case "multi_choice":
      return (answer as MultiChoiceAnswer).optionIds.length > 0;
    case "match":
      return (answer as MatchAnswer).pairs.length === (item as ItemOf<"match">).left.length;
    case "order":
      return (answer as OrderAnswer).sequence.length === (item as ItemOf<"order">).parts.length;
    case "gap_choice":
      return gapsOf((item as ItemOf<"gap_choice">).segments).every(
        (g) => !!(answer as GapChoiceAnswer)[g],
      );
    case "gap_text":
      return Object.values(answer as GapTextAnswer).some((v) => v.trim() !== "");
    case "dictation":
    case "respond":
      return (answer as { text: string }).text.trim() !== "";
    case "speech_repeat":
      // Nothing heard is no answer to check: the learner says it again (or skips).
      return (answer as SpeechRepeatAnswer).speech.transcript.trim() !== "";
    default:
      return true;
  }
}

/** What was heard of an answer said aloud to a speaking item with no phrase to say (the AI checks
 *  it, 08); undefined for anything else, or nothing heard. */
export function spokenFreely(exercise: Exercise, index: number, answer: unknown) {
  const item = exercise.items[index] as ItemOf<"speech_selfrate"> | undefined;
  if (exercise.type !== "speech_selfrate" || !item || item.text) return undefined;
  const transcript = (answer as { transcript?: unknown } | undefined)?.transcript;
  return typeof transcript === "string" && transcript.trim() ? transcript : undefined;
}
