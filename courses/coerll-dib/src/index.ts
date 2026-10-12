import type { CourseProvider } from "@sprachanker/course-kit";
import { OFFERS, SERIES } from "./catalog.ts";
import { importDib } from "./import.ts";

/** COERLL «Deutsch im Blick». */
export const DIB_PROVIDER: CourseProvider = {
  id: "coerll-dib",
  series: SERIES,
  offers: OFFERS,
  import: importDib,
};
