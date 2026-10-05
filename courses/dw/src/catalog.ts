// DW Learn German courses (03, research): one provider for the platform, a series per DW course. Source
// ids are the DW course page ids per edition.
export const SITE = "https://learngerman.dw.com";
export const USER_AGENT =
  "SprachAnker/0.1 (personal-use course importer; +https://github.com/kafeg/sprachanker)";

export type DwSeries = "nicos-weg" | "deutschtrainer";

export interface DwCourse {
  series: DwSeries;
  course: string;
  edition: "ru-de" | "en-de" | "de-de";
  /** Language segment of DW URLs. */
  lang: "ru" | "en" | "de";
  sourceId: number;
}

/** The first edition of each course writes its canonical files (03, "Edition alignment"). */
export const COURSES: DwCourse[] = [
  { series: "nicos-weg", course: "a1", edition: "ru-de", lang: "ru", sourceId: 45476888 },
  { series: "nicos-weg", course: "a1", edition: "en-de", lang: "en", sourceId: 36519789 },
  { series: "nicos-weg", course: "a2", edition: "ru-de", lang: "ru", sourceId: 45476921 },
  { series: "nicos-weg", course: "a2", edition: "en-de", lang: "en", sourceId: 36519797 },
  { series: "nicos-weg", course: "b1", edition: "de-de", lang: "de", sourceId: 36519718 },
  // 100 short lessons, A1 and A2, words and phrases by topic.
  { series: "deutschtrainer", course: "a1-a2", edition: "ru-de", lang: "ru", sourceId: 57409152 },
];

/** Library folder of a series: `dw.<series>`. */
export const seriesId = (series: DwSeries) => `dw.${series}`;
