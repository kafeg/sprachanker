// BAMF — the "Leben in Deutschland" test and the naturalisation test (03, research exams.md): one
// exam course in German. The questions, options, state sections and pictures come from BAMF's
// catalogue PDF; the right answers from BAMF's online test centre (the PDF marks none).
import type { CourseOffer } from "@sprachanker/course-kit";
import {
  type CourseSource,
  courseKey,
  examKey,
  type FederalState,
  seriesKey,
} from "@sprachanker/schema";

export const SERIES = seriesKey("bamf", "lid");
export const COURSE = "lid";
/** The catalogue is German only: the exam is taken in German. */
export const EDITION = "de-de";
export const COURSE_KEY = courseKey(SERIES, COURSE);
export const EXAM_KEY = examKey(COURSE_KEY, "test");

/** The catalogue as BAMF publishes it (one PDF, "Stand: …" on its first page). */
export const CATALOGUE_PAGE =
  "https://www.bamf.de/SharedDocs/Anlagen/DE/Integration/Einbuergerung/gesamtfragenkatalog-lebenindeutschland.html";
export const CATALOGUE_PDF =
  "https://www.bamf.de/SharedDocs/Anlagen/DE/Integration/Einbuergerung/gesamtfragenkatalog-lebenindeutschland.pdf?__blob=publicationFile";

/** BAMF's online test centre (an Oracle APEX application): the catalogue question by question. */
export const TEST_CENTRE = "https://oet.bamf.de/ords/oetut/";
export const TEST_CENTRE_START = `${TEST_CENTRE}f?p=514:1:0`;

/** Questions of the catalogue: 300 for everyone, 10 per federal state. */
export const GENERAL_QUESTIONS = 300;
export const STATE_QUESTIONS = 10;

/** The federal states as the PDF names them (its sections, in this order) and as the test centre's
 *  state list values them. */
export const STATES: ReadonlyArray<{ code: FederalState; name: string; centre: string }> = [
  { code: "bw", name: "Baden-Württemberg", centre: "2" },
  { code: "by", name: "Bayern", centre: "3" },
  { code: "be", name: "Berlin", centre: "4" },
  { code: "bb", name: "Brandenburg", centre: "14" },
  { code: "hb", name: "Bremen", centre: "5" },
  { code: "hh", name: "Hamburg", centre: "6" },
  { code: "he", name: "Hessen", centre: "7" },
  { code: "mv", name: "Mecklenburg-Vorpommern", centre: "17" },
  { code: "ni", name: "Niedersachsen", centre: "8" },
  { code: "nw", name: "Nordrhein-Westfalen", centre: "9" },
  { code: "rp", name: "Rheinland-Pfalz", centre: "10" },
  { code: "sl", name: "Saarland", centre: "11" },
  { code: "sn", name: "Sachsen", centre: "16" },
  { code: "st", name: "Sachsen-Anhalt", centre: "13" },
  { code: "sh", name: "Schleswig-Holstein", centre: "12" },
  { code: "th", name: "Thüringen", centre: "15" },
];

/**
 * The catalogue is Annex 1 of a federal regulation (EinbTestV); the answers are read from BAMF's
 * own test centre. Neither states terms of use: imported on the learner's machine for their own
 * preparation, as the test centre is used.
 */
export const SOURCE: CourseSource = {
  publisher: "Bundesamt für Migration und Flüchtlinge (BAMF)",
  url: CATALOGUE_PAGE,
  licence: "free-access",
};

/** For the catalogue (03); the size was measured on a full download. */
export const OFFERS: CourseOffer[] = [
  {
    course: COURSE,
    edition: EDITION,
    kind: "exam",
    title: "Leben in Deutschland",
    source: SOURCE,
    approxBytes: 0.06e9,
    stable: true,
  },
];
