// Our layer over a lesson, keyed by stable keys and fingerprints (02, "Enrichment").
import { z } from "zod";
import { format, LocalizedText, Sha256 } from "./common.ts";
import { Exercise } from "./exercise/index.ts";
import { ExerciseKey, LessonKey, LexemeKey, RuleId, SceneKey } from "./keys.ts";
import { ItemRef } from "./locale.ts";

export const ENRICHMENT_FORMAT = 1;

/** `courses/<provider>/enrichment/<course>/<NN>-<NN>.yaml` */
export const Enrichment = z.object({
  format: format(ENRICHMENT_FORMAT),
  lesson: LessonKey,
  rules: z.array(RuleId).default([]),
  /** Contrastive notes per learner language; markdown. */
  notes: LocalizedText.optional(),
  exercises: z
    .record(
      ExerciseKey,
      z.object({
        /** The entry is stale (skipped and reported) when this differs from the exercise. */
        fingerprint: Sha256,
        ruleIds: z.array(RuleId).optional(),
        /** Override of the selfrate upgrade (04). */
        upgrade: z.enum(["speech_repeat", "respond"]).optional(),
        /** Extra accepted answers per item. */
        accepted: z.record(ItemRef, z.array(z.string().min(1))).optional(),
      }),
    )
    .default({}),
  extra: z
    .array(
      z.object({
        /** Existing exercise key, or `end`. */
        after: z.union([ExerciseKey, z.literal("end")]),
        exercise: Exercise,
      }),
    )
    .default([]),
  scenes: z.array(SceneKey).default([]),
  cards: z.object({ phrases: z.array(LexemeKey) }).optional(),
});
export type Enrichment = z.infer<typeof Enrichment>;
