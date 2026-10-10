import type { CourseProvider } from "@sprachanker/course-kit";
import { OFFERS, SERIES } from "./catalog.ts";
import { importLid } from "./import.ts";

/** BAMF «Leben in Deutschland» (03): the test's whole catalogue with its answers, as an exam. */
export const LID_PROVIDER: CourseProvider = {
  id: "bamf-lid",
  series: SERIES,
  offers: OFFERS,
  import: importLid,
};
