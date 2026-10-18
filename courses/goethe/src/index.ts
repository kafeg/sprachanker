import type { CourseProvider } from "@sprachanker/course-kit";
import { OFFERS, SERIES } from "./catalog.ts";
import { importGoethe } from "./import.ts";

/** Goethe-Institut's model tests A1, A2, B1: each level's Modellsatz as an exam, every one ready for
 *  learning (owner, 2026-10-18). */
export const GOETHE_PROVIDER: CourseProvider = {
  id: "goethe",
  series: SERIES,
  stable: true,
  offers: OFFERS,
  import: importGoethe,
};
