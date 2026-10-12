// DW Learn German courses: one provider for the platform, a series per DW course. Each
// language edition of a DW course is a course of its own (DW publishes them as separate courses that
// differ in exercises and their order): `a1-ru` and `a1-en` share nothing but the series.
import type { CourseOffer } from "@sprachanker/course-kit";
import { type CourseSource, type EditionId, seriesKey } from "@sprachanker/schema";

export const SITE = "https://learngerman.dw.com";

export type DwSeries = "nicos-weg" | "deutschtrainer";

export interface DwCourse {
  series: DwSeries;
  /** Our course id: the DW course and the learner's language (`a1-ru`). */
  id: string;
  /** The DW course it comes from (`a1`): the folder of its raw pages. */
  course: string;
  /** `<learner's language>-de`. */
  edition: EditionId;
  /** Language segment of DW URLs (`ru`, `pt-br`, `fa-ir`). */
  lang: string;
  sourceId: number;
  /** Bytes of the course downloaded on its own (videos in SD and HD make most of it); editions of a
   *  series share their media, so another edition adds far less. */
  approxBytes: number;
}

/**
 * Nicos Weg in every language DW publishes it (research, October 2026): the URL segment, our language
 * code, and the course ids of A1 and A2 (Swahili has only A1). B1 exists in German only.
 */
const NICOS_WEG: Array<[segment: string, lang: string, a1: number, a2?: number]> = [
  ["ru", "ru", 45476888, 45476921],
  ["en", "en", 36519789, 36519797],
  ["de", "de", 36519687, 36519709],
  ["ar", "ar", 36519911, 36519923],
  ["bs", "bs", 63700880, 64297340],
  ["el", "el", 61913011, 61998903],
  ["es", "es", 47994059, 47994051],
  ["fa-ir", "fa", 45477023, 45477041],
  ["fr", "fr", 47994036, 47994035],
  ["hi", "hi", 71245621, 71245696],
  ["hu", "hu", 65959869, 66442819],
  ["id", "id", 75397583, 75929056],
  ["pl", "pl", 50080643, 50080708],
  ["pt-br", "pt", 45457080, 45476771],
  ["ro", "ro", 61583453, 61816530],
  ["sw", "sw", 77498923],
  ["tr", "tr", 54846011, 47993853],
  ["uk", "uk", 57366636, 57366663],
  ["zh", "zh", 47993645, 47993807],
];

const nicosWeg = (
  course: "a1" | "a2",
  segment: string,
  lang: string,
  sourceId: number,
): DwCourse => ({
  series: "nicos-weg",
  id: `${course}-${lang}`,
  course,
  edition: `${lang}-de`,
  lang: segment,
  sourceId,
  approxBytes: course === "a1" ? 3.18e9 : 3.36e9,
});

export const COURSES: DwCourse[] = [
  ...NICOS_WEG.flatMap(([segment, lang, a1, a2]) => [
    nicosWeg("a1", segment, lang, a1),
    ...(a2 ? [nicosWeg("a2", segment, lang, a2)] : []),
  ]),
  {
    series: "nicos-weg",
    id: "b1-de",
    course: "b1",
    edition: "de-de",
    lang: "de",
    sourceId: 36519718,
    approxBytes: 3.27e9,
  },
  // 100 short lessons, A1 and A2, words and phrases by topic.
  {
    series: "deutschtrainer",
    id: "a1-a2-ru",
    course: "a1-a2",
    edition: "ru-de",
    lang: "ru",
    sourceId: 57409152,
    approxBytes: 4.64e9,
  },
];

/** Library folder of a series: `dw.<series>`. */
export const seriesId = (series: DwSeries) => seriesKey("dw", series);

export const SOURCE: CourseSource = {
  publisher: "Deutsche Welle",
  url: `${SITE}/de`,
  licence: "free-access",
};

const NAMES: Record<DwSeries, string> = {
  "nicos-weg": "Nicos Weg",
  deutschtrainer: "Deutschtrainer",
};

/** The courses of a DW series, for the catalogue. */
export const offers = (series: DwSeries): CourseOffer[] =>
  COURSES.filter((c) => c.series === series).map((c) => ({
    course: c.id,
    edition: c.edition,
    title: `${NAMES[c.series]} ${c.course.toUpperCase()}`,
    source: SOURCE,
    approxBytes: c.approxBytes,
  }));
