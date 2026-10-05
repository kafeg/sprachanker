// DW Nicos Weg courses (03, research). Source ids are the DW course page ids per edition.
export const SITE = "https://learngerman.dw.com";
export const SERIES = "dw.nicos-weg";
export const USER_AGENT =
  "SprachAnker/0.1 (personal-use course importer; +https://github.com/kafeg/sprachanker)";

export interface DwCourse {
  course: "a1" | "a2" | "b1";
  edition: "ru-de" | "en-de" | "de-de";
  /** Language segment of DW URLs. */
  lang: "ru" | "en" | "de";
  sourceId: number;
}

export const COURSES: DwCourse[] = [
  { course: "a1", edition: "ru-de", lang: "ru", sourceId: 45476888 },
  { course: "a2", edition: "ru-de", lang: "ru", sourceId: 45476921 },
  { course: "b1", edition: "de-de", lang: "de", sourceId: 36519718 },
];
