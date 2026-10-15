// Exercise fingerprints.
import type { Exercise } from "@sprachanker/schema";
import { canonicalJson } from "./canonical-json.ts";
import { sha256Hex } from "./hash.ts";

/** An exercise before its fingerprint is computed. */
export type ExerciseDraft = Exercise extends infer E
  ? E extends Exercise
    ? Omit<E, "fingerprint">
    : never
  : never;

/** sha256 of the canonical JSON of an exercise without its `fingerprint`. */
export function fingerprint(exercise: ExerciseDraft | Exercise): string {
  const { fingerprint: _, ...rest } = exercise as Exercise;
  return sha256Hex(canonicalJson(rest));
}

/** The exercise with its fingerprint set. */
export function withFingerprint(exercise: ExerciseDraft): Exercise {
  return { ...exercise, fingerprint: fingerprint(exercise) } as Exercise;
}
