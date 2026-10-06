// DW Learn German courses (03, research): one provider for the platform, a series per DW course. Each
// language edition of a DW course is a course of its own (DW publishes them as separate courses that
// differ in exercises and their order): `a1-ru` and `a1-en` share nothing but the series.
import { seriesKey } from "@sprachanker/schema";

export const SITE = "https://learngerman.dw.com";
export { IMPORTER_USER_AGENT as USER_AGENT } from "@sprachanker/course-kit";

export type DwSeries = "nicos-weg" | "deutschtrainer";

export interface DwCourse {
  series: DwSeries;
  /** Our course id: the DW course and the learner's language (`a1-ru`). */
  id: string;
  /** The DW course it comes from (`a1`): the folder of its raw pages. */
  course: string;
  edition: "ru-de" | "en-de" | "de-de";
  /** Language segment of DW URLs. */
  lang: "ru" | "en" | "de";
  sourceId: number;
}

export const COURSES: DwCourse[] = [
  {
    series: "nicos-weg",
    id: "a1-ru",
    course: "a1",
    edition: "ru-de",
    lang: "ru",
    sourceId: 45476888,
  },
  {
    series: "nicos-weg",
    id: "a1-en",
    course: "a1",
    edition: "en-de",
    lang: "en",
    sourceId: 36519789,
  },
  {
    series: "nicos-weg",
    id: "a2-ru",
    course: "a2",
    edition: "ru-de",
    lang: "ru",
    sourceId: 45476921,
  },
  {
    series: "nicos-weg",
    id: "a2-en",
    course: "a2",
    edition: "en-de",
    lang: "en",
    sourceId: 36519797,
  },
  {
    series: "nicos-weg",
    id: "b1-de",
    course: "b1",
    edition: "de-de",
    lang: "de",
    sourceId: 36519718,
  },
  // 100 short lessons, A1 and A2, words and phrases by topic.
  {
    series: "deutschtrainer",
    id: "a1-a2-ru",
    course: "a1-a2",
    edition: "ru-de",
    lang: "ru",
    sourceId: 57409152,
  },
];

/** Library folder of a series: `dw.<series>`. */
export const seriesId = (series: DwSeries) => seriesKey("dw", series);
