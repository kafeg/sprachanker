import type { CourseProvider } from "@sprachanker/course-kit";
import { OFFERS, SERIES } from "./catalog.ts";
import { importLid } from "./import.ts";

/** BAMF «Leben in Deutschland»: the test's whole catalogue with its answers, as an exam. */
export const LID_PROVIDER: CourseProvider = {
  id: "bamf-lid",
  series: SERIES,
  stable: true,
  offers: OFFERS,
  import: importLid,
};
