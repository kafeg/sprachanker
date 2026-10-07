// Exercise fingerprints (02, "Keys and identity").
import { createHash } from "node:crypto";
import type { Exercise } from "@sprachanker/schema";
import { canonicalJson } from "./canonical-json.ts";

const sha256Hex = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

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
