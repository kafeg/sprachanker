// Exercises as a normaliser drafts them: built from a source's data as the mapping goes,
// checked against their type's schema where they are made, and fingerprinted. What cannot be mapped
// becomes an `unknown` exercise with the reason, so the lesson still shows where it was.
import {
  type Exercise,
  Exercise as ExerciseSchema,
  issuesText,
  itemKey,
} from "@sprachanker/schema";
import { type ExerciseDraft, withFingerprint } from "./fingerprint.ts";

/** A source exercise the mapping cannot take (an unseen mechanic, missing data): thrown inside a
 *  provider's mapping, caught where the exercise becomes `unknown` with its message as the reason. */
export class Unmapped extends Error {}

/** What every exercise of a lesson has besides its type and items. */
interface ExerciseCommon {
  key: Exercise["key"];
  newWords?: Exercise["newWords"];
  ruleIds?: Exercise["ruleIds"];
  media?: Exercise["media"];
}

const NO_FINGERPRINT = "0".repeat(64);

/** What a mapping makes of a source exercise: its type and items, and whatever else its type takes
 *  (a text, a display). */
export type MappedDraft = {
  type: Exercise["type"];
  items: unknown[];
} & Record<string, unknown>;

/** An exercise as a mapping builds it: what every exercise has and what the mapping made. */
type LooseDraft = ExerciseCommon & MappedDraft;

/**
 * An exercise checked against its type's schema; one that does not fit throws `Unmapped` with what
 * did not (the mapping's mistake, reported where it is made). The fingerprint is the draft's own
 *, not of a reading of it.
 */
export function draftExercise(loose: LooseDraft): Exercise {
  const draft = { newWords: [], ruleIds: [], ...loose };
  const checked = ExerciseSchema.safeParse({ ...draft, fingerprint: NO_FINGERPRINT });
  if (!checked.success)
    throw new Unmapped(`${loose.type} does not fit: ${issuesText(checked.error, 1)}`);
  return withFingerprint(draft as unknown as ExerciseDraft);
}

/** The `unknown` exercise standing where one could not be mapped: the raw page it came from and why.
 *  Built as it is, never checked: what stands for a failure must not fail itself. */
export function unknownExercise(common: ExerciseCommon, raw: string, reason: string): Exercise {
  const { key, newWords = [], ruleIds = [], media } = common;
  // In the order a drafted one has (the files keep it).
  return withFingerprint({
    newWords,
    ruleIds,
    key,
    ...(media && { media }),
    type: "unknown",
    items: [{ key: itemKey(key, 1), raw, reason }],
  });
}

/** An exercise mapped and drafted, or — when the mapping throws `Unmapped` or what it made does not
 *  fit its type — the `unknown` one standing for it, with why (for the lesson's unmapped list). */
export function draftOrUnknown(
  common: ExerciseCommon,
  raw: string,
  map: () => MappedDraft,
): { exercise: Exercise; unmapped?: string } {
  try {
    return { exercise: draftExercise({ ...common, ...map() }) };
  } catch (error) {
    if (!(error instanceof Unmapped)) throw error;
    return { exercise: unknownExercise(common, raw, error.message), unmapped: error.message };
  }
}
