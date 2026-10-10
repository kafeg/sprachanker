// Result of checking one answer (04, "Checking").
import { z } from "zod";

export const TokenDiff = z.object({
  op: z.enum(["equal", "missing", "extra", "wrong"]),
  expected: z.string().optional(),
  actual: z.string().optional(),
});
export type TokenDiff = z.infer<typeof TokenDiff>;

/** Stored answers may also carry `ruleIds`, `lexemes` (both written empty) and, for `respond`,
 *  `needsLlm`: nothing reads them, and they are dropped when read (05). */
export const Outcome = z.object({
  result: z.enum(["correct", "partial", "wrong", "unscored"]),
  /** 0..1; partial = share of matched ids or words. */
  score: z.number().min(0).max(1),
  diff: z.array(TokenDiff).optional(),
  /** Each part right or not: gaps by gap id, match pairs by left id (what the item marks). */
  parts: z.record(z.string(), z.boolean()).optional(),
});
export type Outcome = z.infer<typeof Outcome>;
