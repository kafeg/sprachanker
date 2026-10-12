// COERLL — Deutsch im Blick, 2nd edition: CC BY 4.0. One course,
// ten chapters; the site has vocabulary with audio, interviews and the textbook PDF per chapter.
import type { CourseOffer } from "@sprachanker/course-kit";
import { type CourseSource, seriesKey } from "@sprachanker/schema";

export const SITE = "https://coerll.utexas.edu/dib/";
export const SERIES = seriesKey("coerll", "dib");
export const COURSE = "dib";
export const EDITION = "en-de";
export const CHAPTERS = 10;

/** Attribution required by CC BY 4.0, shown with the course (course HTML has no links). */
export const ATTRIBUTION_HTML =
  "<p>Deutsch im Blick, 2nd edition (2017), COERLL, The University of Texas at Austin " +
  "(coerll.utexas.edu/dib) — licensed CC BY 4.0 (creativecommons.org/licenses/by/4.0). " +
  "Imported for personal study.</p>";

export const SOURCE: CourseSource = {
  publisher: "COERLL, The University of Texas at Austin",
  url: SITE,
  licence: "cc-by-4.0",
};

/** For the catalogue; the size was measured on a full download. */
export const OFFERS: CourseOffer[] = [
  {
    course: COURSE,
    edition: EDITION,
    title: "Deutsch im Blick",
    source: SOURCE,
    approxBytes: 0.16e9,
  },
];
