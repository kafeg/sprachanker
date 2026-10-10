// Exams with real exam rules: pools, draws, time limit, pass marks (02; Leben in Deutschland).
import { z } from "zod";
import { format } from "./common.ts";
import { SingleChoiceItem } from "./exercise/index.ts";
import { ExamItemKey, ExamKey, ExamSectionKey } from "./keys.ts";

export const EXAM_FORMAT = 1;

const ThresholdId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/** Germany's federal states by their ISO 3166-2 codes: the Leben in Deutschland test asks three
 *  questions of the learner's state (profile setting `exam.federalState`). */
export const FEDERAL_STATES = [
  "bw",
  "by",
  "be",
  "bb",
  "hb",
  "hh",
  "he",
  "mv",
  "ni",
  "nw",
  "rp",
  "sl",
  "sn",
  "st",
  "sh",
  "th",
] as const;
export const FederalState = z.enum(FEDERAL_STATES);
export type FederalState = z.infer<typeof FederalState>;

/** An exam question: a single_choice item keyed in the exam, with tags used by section filters. */
export const ExamItem = SingleChoiceItem.extend({
  key: ExamItemKey,
  type: z.literal("single_choice"),
  /** e.g. `{ federalState: "be" }`; `null` = applies to everyone. */
  tags: z.record(z.string(), z.string().nullable()),
});
export type ExamItem = z.infer<typeof ExamItem>;

/** `canonical/<course>/exams/<slug>.json` */
export const Exam = z.strictObject({
  format: format(EXAM_FORMAT),
  key: ExamKey,
  timeLimitSec: z.number().int().positive(),
  sections: z.array(
    z.strictObject({
      key: ExamSectionKey,
      pool: z.array(ExamItemKey).min(1),
      draw: z.number().int().positive(),
      /** Draw only items whose `tag` has the value of the profile setting `setting`
       *  (`{ tag: "federalState", setting: "exam.federalState" }`). */
      filter: z.strictObject({ tag: z.string().min(1), setting: z.string().min(1) }).nullable(),
    }),
  ),
  items: z.array(ExamItem).min(1),
  /** Pass marks shown to the learner, e.g. course test 15, naturalisation 17; titles in locale. */
  thresholds: z
    .array(z.strictObject({ id: ThresholdId, minPoints: z.number().int().positive() }))
    .min(1),
});
export type Exam = z.infer<typeof Exam>;
