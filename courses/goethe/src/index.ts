import type { CourseProvider } from "@sprachanker/course-kit";
import { OFFERS, SERIES } from "./catalog.ts";
import { importGoethe } from "./import.ts";

/** Goethe-Institut's model tests A1, A2, B1: each level's Modellsatz as an exam. A1 is ready for
 *  learning (owner, 2026-10-12); A2 and B1 stay experimental. */
export const GOETHE_PROVIDER: CourseProvider = {
  id: "goethe",
  series: SERIES,
  stable: ["a1"],
  offers: OFFERS,
  import: importGoethe,
};
