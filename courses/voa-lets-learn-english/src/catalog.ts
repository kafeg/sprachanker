// VOA Learning English «Let's Learn English» (learningenglish.voanews.com): VOA's own material is public
// domain (third-party photos are not, so images are not fetched). Two courses, each listed on a landing
// page that links its lesson pages in course order.
import { seriesKey } from "@sprachanker/schema";

export const SITE = "https://learningenglish.voanews.com";
export const HOST = "learningenglish.voanews.com";
export const SERIES = seriesKey("voa", "lets-learn-english");
export const EDITION = "en-en";

export interface CourseDef {
  id: string;
  title: string;
  /** Landing page listing the course's lessons. */
  landing: string;
}

export const COURSES: CourseDef[] = [
  { id: "level-1", title: "Let's Learn English — Level 1", landing: "/p/5644.html" },
  { id: "level-2", title: "Let's Learn English — Level 2", landing: "/p/6765.html" },
];

/** Course description with the source's attribution (plain text, no links; 02). */
export const ATTRIBUTION_HTML =
  "<p>Let's Learn English, VOA Learning English (Voice of America) — public domain. " +
  "Imported for personal study.</p>";
