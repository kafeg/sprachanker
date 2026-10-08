// VOA Learning English «Let's Learn English» (learningenglish.voanews.com): en → en, series voa.lets-learn-english.
import type { CourseProvider } from "@sprachanker/course-kit";
import { OFFERS, SERIES } from "./catalog.ts";
import { importLetsLearnEnglish } from "./import.ts";

export const LETS_LEARN_ENGLISH_PROVIDER: CourseProvider = {
  id: "voa-lets-learn-english",
  series: SERIES,
  offers: OFFERS,
  import: importLetsLearnEnglish,
};
