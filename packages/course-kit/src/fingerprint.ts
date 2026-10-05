// Exercise fingerprints (02, "Keys and identity").
import { createHash } from "node:crypto";
import type { Exercise } from "@sprachanker/schema";
import { canonicalJson } from "./canonical-json.ts";

export const sha256Hex = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex");

/** sha256 of the canonical JSON of an exercise without its `fingerprint`. */
export function fingerprint(exercise: Omit<Exercise, "fingerprint"> | Exercise): string {
  const { fingerprint: _, ...rest } = exercise as Exercise;
  return sha256Hex(canonicalJson(rest));
}

/** The exercise with its fingerprint set. */
export function withFingerprint<E extends Exercise>(exercise: Omit<E, "fingerprint">): E {
  return { ...exercise, fingerprint: fingerprint(exercise) } as E;
}
