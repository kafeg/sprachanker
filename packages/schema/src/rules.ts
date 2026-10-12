// Grammar rules registry `courses/_shared/rules/<lang>.yaml`.
import { z } from "zod";
import { LocalizedText } from "./common.ts";
import { RuleId } from "./keys.ts";

const GrammarRule = z.strictObject({
  id: RuleId,
  /** Short title per UI/learner language. */
  title: LocalizedText,
  /** Contrastive explanation per learner language; markdown. */
  explanation: LocalizedText,
  /** Target-language examples. */
  examples: z.array(z.string().min(1)),
});

/** One registry file: the rules of one target language; ids are unique. */
export const RulesRegistry = z.array(GrammarRule).superRefine((rules, ctx) => {
  const seen = new Set<string>();
  rules.forEach((rule, index) => {
    if (seen.has(rule.id)) {
      ctx.addIssue({
        code: "custom",
        path: [index, "id"],
        message: `duplicate rule id ${rule.id}`,
      });
    }
    seen.add(rule.id);
  });
});
export type RulesRegistry = z.infer<typeof RulesRegistry>;
