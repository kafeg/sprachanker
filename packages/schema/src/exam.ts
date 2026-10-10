// Exams with real exam rules: pools, draws, time limits, pass marks (02): one test of drawn questions
// (Leben in Deutschland), or modules of Teile with their material (Goethe's Hören, Lesen, …).
import { z } from "zod";
import { format, Media, Sha256 } from "./common.ts";
import { GapTextItem, RespondItem, SingleChoiceItem } from "./exercise/index.ts";
import { ExamItemKey, ExamKey, ExamSectionKey } from "./keys.ts";

export const EXAM_FORMAT = 1;

const ThresholdId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
/** A module of an exam: `hoeren`, `lesen`, `schreiben`, `sprechen`. */
export const ExamModuleId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export type ExamModuleId = z.infer<typeof ExamModuleId>;

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

/** What every exam question has besides its kind's item. */
const examQuestion = {
  key: ExamItemKey,
  /** e.g. `{ federalState: "be" }`; `null` = applies to everyone. */
  tags: z.record(z.string(), z.string().nullable()),
  /** What a right answer scores (1 when not given); an open answer scores its share of them. */
  points: z.number().positive().optional(),
  /** A text of this question's own above it (target language; paragraphs by blank lines). */
  text: z.string().optional(),
  /**
   * An open answer's criteria (writing, speaking), as the exam's raters judge it: each with the points
   * of its levels from best to worst (Goethe A1 Schreiben 2: a content point 3, 1.5 or 0); `voids`: a
   * 0 there makes the whole answer 0 ("Erfüllung" E). The answer scores the levels chosen — by the
   * learner, or proposed by the assistant and taken (`exam_rated`, 05); their titles in the locale.
   */
  criteria: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        levels: z.array(z.number().nonnegative()).min(2),
        voids: z.boolean().optional(),
      }),
    )
    .min(1)
    .optional(),
};

/** An exam question: an item of one of the kinds an exam asks, keyed in the exam. */
export const ExamItem = z.discriminatedUnion("type", [
  SingleChoiceItem.extend({ ...examQuestion, type: z.literal("single_choice") }),
  GapTextItem.extend({ ...examQuestion, type: z.literal("gap_text") }),
  RespondItem.extend({ ...examQuestion, type: z.literal("respond") }),
]);
export type ExamItem = z.infer<typeof ExamItem>;
export type ExamItemType = ExamItem["type"];

/** `canonical/<course>/exams/<slug>.json` */
export const Exam = z.strictObject({
  format: format(EXAM_FORMAT),
  key: ExamKey,
  /** The whole exam's time (with modules: theirs together). */
  timeLimitSec: z.number().int().positive(),
  /** The exam's modules in the order they are taken, each timed, its points scaled to `scaleTo`
   *  (Goethe A1: 15 points to 25); sections name theirs. None: one test (Leben in Deutschland). */
  modules: z
    .array(
      z.strictObject({
        id: ExamModuleId,
        timeLimitSec: z.number().int().positive(),
        scaleTo: z.number().positive().optional(),
        /** Its scaled points rounded to whole points (Goethe B1: 29 → 97). */
        round: z.boolean().optional(),
      }),
    )
    .optional(),
  /** Sections: the pools questions are drawn from — with modules, a module's Teile with all their
   *  questions asked, each with its material. */
  sections: z.array(
    z.strictObject({
      key: ExamSectionKey,
      pool: z.array(ExamItemKey).min(1),
      draw: z.number().int().positive(),
      /** Draw only items whose `tag` has the value of the profile setting `setting`
       *  (`{ tag: "federalState", setting: "exam.federalState" }`). */
      filter: z.strictObject({ tag: z.string().min(1), setting: z.string().min(1) }).nullable(),
      module: ExamModuleId.optional(),
      /** A text the Teil's questions share (target language; paragraphs by blank lines). */
      text: z.string().optional(),
      /** The Teil's recording or picture. */
      media: Media.optional(),
      /** What its questions are answered from by letter, each shown once: ads, pictures (Goethe B1
       *  Lesen 3: a–j; A2 Hören 2: pictures a–i). */
      letters: z
        .array(
          z.strictObject({
            letter: z.string().min(1).max(2),
            text: z.string().optional(),
            media: Media.optional(),
          }),
        )
        .optional(),
      /** How often a recording of the Teil — its own or a question's — may be played. */
      plays: z.number().int().positive().optional(),
      /** Questions shown answered as the example ("Beispiel 0"; B1 Hören has two); in no pool,
       *  never scored. */
      examples: z.array(ExamItemKey).optional(),
    }),
  ),
  items: z.array(ExamItem).min(1),
  /** Pass marks shown to the learner, e.g. course test 15, naturalisation 17; titles in locale.
   *  With `modules`, over the scaled points of those modules (all when not given). */
  thresholds: z
    .array(
      z.strictObject({
        id: ThresholdId,
        minPoints: z.number().positive(),
        modules: z.array(ExamModuleId).optional(),
      }),
    )
    .min(1),
  /** The modules' scaled points together rounded to whole points before the pass marks are
   *  applied (Goethe A1). */
  roundTotal: z.boolean().optional(),
  /** Passed when any pass mark is reached (each its own purpose: LiD's course test and
   *  naturalisation), or only when all are (Goethe A2: overall, written and spoken). */
  passWhen: z.enum(["any", "all"]).optional(),
});
export type Exam = z.infer<typeof Exam>;

/** The checks an importer runs on an exam's sources (03; the app names each in its language). */
export const EXAM_CHECKS = [
  /** Questions read, of those the source has. */
  "questions-complete",
  /** Questions whose options two sources give word for word (LiD: the PDF and the test centre). */
  "options-agree",
  /** Answers marked the same way twice in their source (LiD: a test centre page's row and radio). */
  "answers-marked-twice",
  /** Answers from a solution page matched to an option of their question (Goethe). */
  "answers-matched",
  /** Questions whose number on the page is their place in the module (Goethe). */
  "numbers-agree",
  /** A page's recordings, each placed with its question or Teil (Goethe). */
  "recordings-placed",
  /** Pictures and recordings kept, of those the questions show. */
  "media-kept",
  /** Open answers whose criteria the page gives with every level's points (Goethe Schreiben). */
  "criteria-read",
] as const;
export const ExamCheck = z.enum(EXAM_CHECKS);
export type ExamCheck = z.infer<typeof ExamCheck>;

/**
 * `canonical/<course>/sources/<slug>.json`: where an exam was read and what was checked (03; owner,
 * 2026-10-10: proof that the data is the source's). Each document the importer read — its address and,
 * for the copy it kept in `raw/`, the copy's path and sha256 (`verify` finds a copy changed since) —,
 * the checks it ran, and where each question and its answer were found.
 */
export const ExamSources = z.strictObject({
  format: format(EXAM_FORMAT),
  exam: ExamKey,
  /** When the documents were read (epoch ms: the newest copy kept). */
  read: z.number().int(),
  documents: z.array(
    z.strictObject({
      id: z.string().regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/),
      title: z.string().min(1),
      url: z.string().url(),
      /** The copy kept: a library path under `raw/`, and its sha256 as read. */
      raw: z.string().startsWith("raw/").optional(),
      sha256: Sha256.optional(),
    }),
  ),
  checks: z.array(
    z.strictObject({
      id: ExamCheck,
      passed: z.number().int().nonnegative(),
      of: z.number().int().nonnegative(),
    }),
  ),
  /** Where each question (and its answer) was found: a document and the place in it. */
  items: z.record(ExamItemKey, z.array(z.strictObject({ document: z.string(), at: z.string() }))),
});
export type ExamSources = z.infer<typeof ExamSources>;
