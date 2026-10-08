// Exercises as a normaliser drafts them (02, 03): built from a source's data as the mapping goes,
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
export interface ExerciseCommon {
  key: Exercise["key"];
  newWords?: Exercise["newWords"];
  ruleIds?: Exercise["ruleIds"];
  media?: Exercise["media"];
}

const NO_FINGERPRINT = "0".repeat(64);

/** An exercise as a mapping builds it: what every exercise has, its type and items, and whatever
 *  else its type takes (a text, a display). */
export type LooseDraft = ExerciseCommon & {
  type: Exercise["type"];
  items: unknown[];
} & Record<string, unknown>;

/**
 * An exercise checked against its type's schema; one that does not fit throws `Unmapped` with what
 * did not (the mapping's mistake, reported where it is made). The fingerprint is the draft's own
 * (02), not of a reading of it.
 */
export function draftExercise(loose: LooseDraft): Exercise {
  const draft = { newWords: [], ruleIds: [], ...loose };
  const checked = ExerciseSchema.safeParse({ ...draft, fingerprint: NO_FINGERPRINT });
  if (!checked.success)
    throw new Unmapped(`${loose.type} does not fit: ${issuesText(checked.error, 1)}`);
  return withFingerprint(draft as unknown as ExerciseDraft);
}

/** The `unknown` exercise standing where one could not be mapped: the raw page it came from and why. */
export const unknownExercise = (common: ExerciseCommon, raw: string, reason: string): Exercise =>
  draftExercise({
    ...common,
    type: "unknown",
    items: [{ key: itemKey(common.key, 1), raw, reason }],
  });
