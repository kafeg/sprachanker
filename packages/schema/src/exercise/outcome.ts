// Result of checking one answer.
import { z } from "zod";

export const TokenDiff = z.object({
  op: z.enum(["equal", "missing", "extra", "wrong"]),
  expected: z.string().optional(),
  actual: z.string().optional(),
});
export type TokenDiff = z.infer<typeof TokenDiff>;

/** Stored answers may also carry `ruleIds`, `lexemes` (both written empty) and, for `respond`,
 *  `needsLlm`: nothing reads them, and they are dropped when read. */
export const Outcome = z.object({
  result: z.enum(["correct", "partial", "wrong", "unscored"]),
  /** 0..1; partial = share of matched ids or words. */
  score: z.number().min(0).max(1),
  diff: z.array(TokenDiff).optional(),
  /** Each part right or not: gaps by gap id, match pairs by left id (what the item marks). */
  parts: z.record(z.string(), z.boolean()).optional(),
  /** An answer said aloud to a speaking item, as the engine judged what was heard against the line
   *  to say or the source's answer as heard (`unscored` still: a spoken check counts in no score,
   *  only in the exercise's mark). None: nothing to judge it by, or the engine could not decide. */
  spoken: z.enum(["correct", "partial", "wrong"]).optional(),
  /** A spoken answer right by completing the source's frame with the learner's own words (a note
   *  beside `spoken: correct`, never a mistake). */
  ownWords: z.literal(true).optional(),
});
export type Outcome = z.infer<typeof Outcome>;
