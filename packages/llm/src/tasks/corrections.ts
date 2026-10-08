// A checked text as kept (07): corrections that change nothing dropped and an empty "corrected" filled
// with the text itself — small models do both. Shared by the checks of writing and speaking.
import type { Correction } from "@sprachanker/schema";

export const cleanCheck = <T extends { corrected: string; corrections: Correction[] }>(
  check: T,
  text: string,
): T => ({
  ...check,
  corrected: check.corrected.trim() || text.trim(),
  corrections: check.corrections.filter((c) => c.wrong.trim() !== c.right.trim()),
});
