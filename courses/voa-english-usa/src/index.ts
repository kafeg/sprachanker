// VOA «Так говорят в Америке» (golosameriki.com): ru → en, series voa.english-usa.
import type { CourseProvider } from "@sprachanker/course-kit";
import { OFFERS, SERIES } from "./catalog.ts";
import { importEnglishUsa } from "./import.ts";

export const ENGLISH_USA_PROVIDER: CourseProvider = {
  id: "voa-english-usa",
  series: SERIES,
  offers: OFFERS,
  import: importEnglishUsa,
};
