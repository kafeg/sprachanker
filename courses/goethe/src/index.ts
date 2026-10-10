import type { CourseProvider } from "@sprachanker/course-kit";
import { OFFERS, SERIES } from "./catalog.ts";
import { importGoethe } from "./import.ts";

/** Goethe-Institut's model tests A1, A2, B1 (03): each level's Modellsatz as an exam. */
export const GOETHE_PROVIDER: CourseProvider = {
  id: "goethe",
  series: SERIES,
  offers: OFFERS,
  import: importGoethe,
};
