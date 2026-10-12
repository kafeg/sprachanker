// VOA Learning English «Let's Learn English» (learningenglish.voanews.com): VOA's own material is public
// domain (third-party photos are not, so images are not fetched). Two courses, each listed on a landing
// page that links its lesson pages in course order.
import type { CourseOffer } from "@sprachanker/course-kit";
import { type CourseSource, seriesKey } from "@sprachanker/schema";

export const SITE = "https://learningenglish.voanews.com";
export const HOST = "learningenglish.voanews.com";
export const SERIES = seriesKey("voa", "lets-learn-english");
export const EDITION = "en-en";

export interface CourseDef {
  id: string;
  title: string;
  /** Landing page listing the course's lessons. */
  landing: string;
  /** Bytes after a full download, measured (the 720p main videos make most of it). */
  approxBytes: number;
}

export const COURSES: CourseDef[] = [
  {
    id: "level-1",
    title: "Let's Learn English — Level 1",
    landing: "/p/5644.html",
    approxBytes: 5.8e9,
  },
  {
    id: "level-2",
    title: "Let's Learn English — Level 2",
    landing: "/p/6765.html",
    approxBytes: 3.54e9,
  },
];

/** Course description with the source's attribution (plain text, no links). */
export const ATTRIBUTION_HTML =
  "<p>Let's Learn English, VOA Learning English (Voice of America) — public domain. " +
  "Imported for personal study.</p>";

/** Where a course comes from: its landing page at VOA Learning English. */
export const sourceOf = (def: CourseDef): CourseSource => ({
  publisher: "VOA Learning English (Voice of America)",
  url: new URL(def.landing, SITE).href,
  licence: "public-domain",
});

/** For the catalogue. */
export const OFFERS: CourseOffer[] = COURSES.map((def) => ({
  course: def.id,
  edition: EDITION,
  title: def.title,
  source: sourceOf(def),
  approxBytes: def.approxBytes,
}));
