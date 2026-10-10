// Goethe-Institut — the Goethe-Zertifikat model tests (Modellsätze) A1, A2, B1 in their accessible
// online form (03; research exams.md): a course per level, each one exam in German. Every question,
// option, picture, recording and answer comes from the pages: the module pages and a solution page per
// Teil, plain GET over HTTPS.
import type { CourseOffer } from "@sprachanker/course-kit";
import { type CourseSource, courseKey, examKey, seriesKey } from "@sprachanker/schema";

export const SERIES = seriesKey("goethe", "zertifikat");
/** The model tests are German only: taken in German. */
export const EDITION = "de-de";
export const SITE = "https://bfu.goethe.de/";

export type ModuleId = "hoeren" | "lesen";

export interface Level {
  course: "a1" | "a2" | "b1";
  /** The level's folder on the site. */
  dir: string;
  title: string;
  /** Its modules in the order the exam takes them (the pages' module codes 01, 02). */
  modules: ModuleId[];
  /** A module's points scaled as the exam scales them (Durchführungsbestimmungen): A1 each part's 15
   *  points × 1.66; A2 20 × 1.25 = 25; B1 30 → 100. */
  scaleTo: number;
  /** B1's modules are taken and passed apart (60 of 100 each); A1's and A2's together. */
  apart: boolean;
  /** How the regulations round (Durchführungsbestimmungen): B1 each module's result to whole points
   *  (its table: 29 → 97), A1 the parts' sum. */
  rounding: "modules" | "total" | "none";
  /** Its size in the library, measured on a full download. */
  approxBytes: number;
}

export const LEVELS: Level[] = [
  {
    course: "a1",
    dir: "a1_sd1",
    title: "Goethe-Zertifikat A1: Start Deutsch 1",
    modules: ["hoeren", "lesen"],
    scaleTo: 24.9,
    apart: false,
    rounding: "total",
    approxBytes: 0.006e9,
  },
  {
    course: "a2",
    dir: "a2_mod_2MX5",
    title: "Goethe-Zertifikat A2",
    modules: ["hoeren", "lesen"],
    scaleTo: 25,
    apart: false,
    rounding: "none",
    approxBytes: 0.007e9,
  },
  {
    course: "b1",
    dir: "b1_mod",
    title: "Goethe-Zertifikat B1",
    modules: ["lesen", "hoeren"],
    scaleTo: 100,
    apart: true,
    rounding: "modules",
    approxBytes: 0.017e9,
  },
];

/** The exam of each level's course: its Modellsatz. */
export const EXAM_SLUG = "modellsatz";
export const courseOf = (level: Level) => courseKey(SERIES, level.course);
export const examOf = (level: Level) => examKey(courseOf(level), EXAM_SLUG);
export const levelUrl = (level: Level) => `${SITE}${level.dir}/`;

/** The pages state only "© Goethe-Institut"; read on the learner's machine for their own practice,
 *  as the site offers them. */
export const sourceOf = (level: Level): CourseSource => ({
  publisher: "Goethe-Institut",
  url: levelUrl(level),
  licence: "free-access",
});

/** For the catalogue (03). */
export const OFFERS: CourseOffer[] = LEVELS.map((level) => ({
  course: level.course,
  edition: EDITION,
  kind: "exam",
  title: `${level.title} — Modellsatz`,
  source: sourceOf(level),
  approxBytes: level.approxBytes,
}));
