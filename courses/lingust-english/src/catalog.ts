// Lingust «Правильный английский» (lingust.ru): a free ru → en course of 52 lessons in three stages,
// plus bonus materials. Closed licence: personal use, with attribution.
import type { CourseOffer } from "@sprachanker/course-kit";
import { type CourseSource, seriesKey } from "@sprachanker/schema";

export const SITE = "https://lingust.ru/english/english-lessons";
export const HOST = "lingust.ru";
export const SERIES = seriesKey("lingust", "english");
export const COURSE = "english";
export const EDITION = "ru-en";
export const TITLE = "Правильный английский";

/** Bonus pages imported as lessons of a last unit; the rest of the bonus block is not course content. */
export const BONUS = ["irregular-verbs"];

export const ATTRIBUTION_HTML =
  "<p>Lingust — «Правильный английский», free online course (lingust.ru), © Lingust. " +
  "Imported for personal study.</p>";

/** The site serves its recordings only to its own pages (hotlink protection). */
export const MEDIA_REFERER = `${SITE}`;

export const SOURCE: CourseSource = { publisher: "Lingust", url: SITE, licence: "free-access" };

/** For the catalogue (03); the size was measured on a full download. */
export const OFFERS: CourseOffer[] = [
  { course: COURSE, edition: EDITION, title: TITLE, source: SOURCE, approxBytes: 0.05e9 },
];
