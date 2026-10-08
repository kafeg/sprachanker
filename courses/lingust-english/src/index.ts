// Lingust «Правильный английский» (lingust.ru): ru → en, series lingust.english.
import type { CourseProvider } from "@sprachanker/course-kit";
import { OFFERS, SERIES } from "./catalog.ts";
import { importLingust } from "./import.ts";

export const LINGUST_PROVIDER: CourseProvider = {
  id: "lingust-english",
  series: SERIES,
  offers: OFFERS,
  import: importLingust,
};
