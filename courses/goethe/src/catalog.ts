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

export type ModuleId = "hoeren" | "lesen" | "schreiben" | "sprechen";

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
  /** How the writing criteria's bands A–E score where the page does not say (A1's page gives each
   *  level's points): the points of the bands by a criterion's maximum, as the model test's score
   *  sheet ("Schreiben – Bewertung") prints them; the maximum where the page gives none (A2); the
   *  criterion whose E makes the task 0 where only the sheet's criteria say so (B1). */
  writing?: { bands: Record<number, number[]>; max?: number; voids?: string };
  /** How the speaking parts are rated where the page lists no criteria (A1, A2): each part's criteria
   *  with their levels, from the model test's score sheet and the regulations; where it lists each
   *  criterion's maximum (B1), the sheet's bands by maximum and the criterion whose E makes the task 0. */
  speaking?: {
    criteria?: Record<number, Array<{ title: string; levels: number[]; voids?: boolean }>>;
    bands?: Record<number, number[]>;
    voids?: string;
  };
  /** The pass marks the regulations set where they are more than 60 % of each module (B1) or of all
   *  (A1): all needed; titled as the exam's certificate says them. */
  marks?: Array<{ id: string; minPoints: number; modules?: ModuleId[]; title: string }>;
  /** Its size in the library, measured on a full download. */
  approxBytes: number;
}

export const LEVELS: Level[] = [
  {
    course: "a1",
    dir: "a1_sd1",
    title: "Goethe-Zertifikat A1: Start Deutsch 1",
    modules: ["hoeren", "lesen", "schreiben", "sprechen"],
    scaleTo: 24.9,
    apart: false,
    rounding: "total",
    // Durchführungsbestimmungen A1 §5: Sprechen 3 + 6 + 6 points; Modellsatz p. 42: the full points,
    // half or none per task. Teile 2 and 3: two rounds, each a question (a request) and an answer.
    speaking: {
      criteria: {
        1: [{ title: "Sich vorstellen", levels: [3, 1.5, 0] }],
        2: ["Thema 1: Frage", "Thema 1: Antwort", "Thema 2: Frage", "Thema 2: Antwort"].map(
          (title) => ({ title, levels: [1.5, 0.75, 0] }),
        ),
        3: ["Bitte 1", "Reaktion 1", "Bitte 2", "Reaktion 2"].map((title) => ({
          title,
          levels: [1.5, 0.75, 0],
        })),
      },
    },
    approxBytes: 0.006e9,
  },
  {
    course: "a2",
    dir: "a2_mod_2MX5",
    title: "Goethe-Zertifikat A2",
    modules: ["hoeren", "lesen", "schreiben", "sprechen"],
    scaleTo: 25,
    apart: false,
    rounding: "none",
    // Modellsatz A2, p. 38 (Bewertungsbogen Schreiben): Aufgabenerfüllung and Sprache of each Teil.
    writing: { bands: { 5: [5, 3.5, 2, 0.5, 0] }, max: 5 },
    // Durchführungsbestimmungen A2: 60 of 100, of them at least 45 of the written 75 and 15 of the
    // spoken 25.
    marks: [
      { id: "pass", minPoints: 60, title: "Gesamt: 60 von 100 Punkten" },
      {
        id: "written",
        minPoints: 45,
        modules: ["hoeren", "lesen", "schreiben"],
        title: "Schriftlich: 45 von 75 Punkten",
      },
      { id: "spoken", minPoints: 15, modules: ["sprechen"], title: "Mündlich: 15 von 25 Punkten" },
    ],
    // Modellsatz A2, p. 43 (Sprechen – Bewertung): Aufgabenerfüllung and Sprache of each Teil,
    // Aussprache over all three (here with Teil 3); p. 42: Aufgabenerfüllung E makes the Teil 0.
    speaking: {
      criteria: {
        1: [
          { title: "Aufgabenerfüllung", levels: [2, 1.5, 1, 0.5, 0], voids: true },
          { title: "Sprache", levels: [2, 1.5, 1, 0.5, 0] },
        ],
        2: [
          { title: "Aufgabenerfüllung", levels: [4, 3, 2, 1, 0], voids: true },
          { title: "Sprache", levels: [4, 3, 2, 1, 0] },
        ],
        3: [
          { title: "Aufgabenerfüllung", levels: [4, 3, 2, 1, 0], voids: true },
          { title: "Sprache", levels: [4, 3, 2, 1, 0] },
          { title: "Aussprache (Teil 1, 2, 3)", levels: [5, 3.5, 2, 0.5, 0] },
        ],
      },
    },
    approxBytes: 0.007e9,
  },
  {
    course: "b1",
    dir: "b1_mod",
    title: "Goethe-Zertifikat B1",
    modules: ["lesen", "hoeren", "schreiben", "sprechen"],
    scaleTo: 100,
    apart: true,
    rounding: "modules",
    // Modellsatz B1, p. 43 (Schreiben – Bewertung) and p. 42 (Bewertungskriterien: "Erfüllung" E
    // makes the task 0).
    writing: {
      bands: { 10: [10, 7.5, 5, 2.5, 0], 6: [6, 4.5, 3, 1.5, 0], 4: [4, 3, 2, 1, 0] },
      voids: "Erfüllung",
    },
    // Modellsatz B1, p. 47 (Sprechen – Bewertung) and p. 46 ("Erfüllung" E makes the Aufgabe 0).
    speaking: {
      bands: {
        16: [16, 12, 8, 4, 0],
        12: [12, 9, 6, 3, 0],
        8: [8, 6, 4, 2, 0],
        4: [4, 3, 2, 1, 0],
      },
      voids: "Erfüllung",
    },
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
