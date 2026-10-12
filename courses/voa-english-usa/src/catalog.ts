// VOA «Так говорят в Америке» (English USA), golosameriki.com: 104 radio lessons (2001) plus two review
// lessons (52а, 104а), ru → en. VOA staff texts and audio are public domain (site's "Правовая
// информация", /p/3981.html); VOA asks to credit the source.
//
// The lessons are archived articles with non-sequential ids and no index page. The list below was
// taken from the site's sitemap (`/sitemap.xml` → `sitemap_434_<n>.xml.gz`): archive articles titled
// «Урок английского языка №N», all from the 2001 archive (`a-33-a-2001-…`), lesson 28 from 2002.
// Lessons 34, 35, 86 and 87 also exist as identical older copies (2001-08); the later copies are used.
// Lessons 1–31 were republished in 2009 (`learning-english-N`) in a looser layout; the archive copies
// are kept for one consistent layout.
import type { CourseOffer } from "@sprachanker/course-kit";
import { type CourseSource, seriesKey } from "@sprachanker/schema";

export const SITE = "https://www.golosameriki.com";
export const SERIES = seriesKey("voa", "english-usa");
export const COURSE = "english-usa";
export const EDITION = "ru-en";
/** Lessons per unit: the source has no grouping below its two "years" (1–52а, 53–104а). */
export const UNIT_SIZE = 10;

/** Course description: attribution and licence (plain text, no links). */
export const ATTRIBUTION_HTML =
  "<p>«Так говорят в Америке» (English USA), Голос Америки / Voice of America. " +
  "Imported for personal study.</p>" +
  "<p>Тексты и аудиозаписи, созданные сотрудниками «Голоса Америки», являются общественным " +
  "достоянием (public domain); при использовании «Голос Америки» просит указывать источник: " +
  "golosameriki.com / voanews.com.</p>";

/** Lesson label as the source numbers it ("52а" is a review lesson) and its article path. */
export const LESSONS: readonly (readonly [label: string, article: string])[] = [
  ["1", "a-33-a-2001-12-08-16-1/658998"],
  ["2", "a-33-a-2001-12-08-15-1/659004"],
  ["3", "a-33-a-2001-12-08-14-1/659017"],
  ["4", "a-33-a-2001-12-08-13-1/659075"],
  ["5", "a-33-a-2001-12-08-12-1/659942"],
  ["6", "a-33-a-2001-12-11-5-1/653802"],
  ["7", "a-33-a-2001-12-11-4-1/660042"],
  ["8", "a-33-a-2001-12-11-3-1/658108"],
  ["9", "a-33-a-2001-12-11-2-1/654789"],
  ["10", "a-33-a-2001-12-11-1-1/658121"],
  ["11", "a-33-a-2001-12-11-10-1/660068"],
  ["12", "a-33-a-2001-12-11-9-1/652334"],
  ["13", "a-33-a-2001-12-11-8-1/660066"],
  ["14", "a-33-a-2001-12-11-18-1/653449"],
  ["15", "a-33-a-2001-12-11-17-1/658173"],
  ["16", "a-33-a-2001-12-11-30-1/655370"],
  ["17", "a-33-a-2001-12-11-29-1/655832"],
  ["18", "a-33-a-2001-12-11-28-1/657809"],
  ["19", "a-33-a-2001-12-11-27-1/651487"],
  ["20", "a-33-a-2001-12-11-26-1/651485"],
  ["21", "a-33-a-2001-12-14-5-1/622030"],
  ["22", "a-33-a-2001-12-14-4-1/622023"],
  ["23", "a-33-a-2001-12-14-3-1/622015"],
  ["24", "a-33-a-2001-12-14-2-1/655872"],
  ["25", "a-33-a-2001-12-14-1-1/622005"],
  ["26", "a-33-a-2001-12-15-4-1/622200"],
  ["27", "a-33-a-2001-12-15-3-1/622176"],
  ["28", "a-33-a-2002-01-03-1-1/652834"],
  ["29", "a-33-a-2001-12-15-2-1/622169"],
  ["30", "a-33-a-2001-12-15-1-1/622167"],
  ["31", "a-33-a-2001-12-18-5-1/659480"],
  ["32", "a-33-a-2001-12-18-4-1/656172"],
  ["33", "a-33-a-2001-12-18-3-1/656171"],
  ["34", "a-33-a-2001-12-18-2-1/651707"],
  ["35", "a-33-a-2001-12-18-1-1/656169"],
  ["36", "a-33-a-2001-12-19-5-1/651934"],
  ["37", "a-33-a-2001-12-19-4-1/656212"],
  ["38", "a-33-a-2001-12-19-3-1/656201"],
  ["39", "a-33-a-2001-12-19-2-1/656200"],
  ["40", "a-33-a-2001-12-19-1-1/656199"],
  ["41", "a-33-a-2001-12-22-19-1/656324"],
  ["42", "a-33-a-2001-12-22-18-1/652083"],
  ["43", "a-33-a-2001-12-22-17-1/656320"],
  ["44", "a-33-a-2001-12-22-16-1/652100"],
  ["45", "a-33-a-2001-12-22-15-1/622683"],
  ["46", "a-33-a-2001-12-22-14-1/656317"],
  ["47", "a-33-a-2001-12-22-13-1/652110"],
  ["48", "a-33-a-2001-12-22-20-1/656326"],
  ["49", "a-33-a-2001-12-22-12-1/656338"],
  ["50", "a-33-a-2001-12-08-4-1/659905"],
  ["51", "a-33-a-2001-12-15-11-1/655939"],
  ["52", "a-33-a-2001-12-22-2-1/656295"],
  ["52а", "a-33-a-2001-12-29-5-1/652903"],
  ["53", "a-33-a-2001-12-08-11-1/659940"],
  ["54", "a-33-a-2001-12-08-10-1/659013"],
  ["55", "a-33-a-2001-12-08-9-1/654732"],
  ["56", "a-33-a-2001-12-08-8-1/659916"],
  ["57", "a-33-a-2001-12-08-7-1/658861"],
  ["58", "a-33-a-2001-12-11-15-1/622431"],
  ["59", "a-33-a-2001-12-11-14-1/652152"],
  ["60", "a-33-a-2001-12-11-13-1/660089"],
  ["61", "a-33-a-2001-12-11-12-1/660088"],
  ["62", "a-33-a-2001-12-11-11-1/660069"],
  ["63", "a-33-a-2001-12-11-24-1/651470"],
  ["64", "a-33-a-2001-12-11-23-1/655785"],
  ["65", "a-33-a-2001-12-11-22-1/655790"],
  ["66", "a-33-a-2001-12-11-21-1/655787"],
  ["67", "a-33-a-2001-12-11-20-1/651445"],
  ["68", "a-33-a-2001-12-12-4-1/655381"],
  ["69", "a-33-a-2001-12-12-3-1/655376"],
  ["70", "a-33-a-2001-12-12-9-1/656328"],
  ["71", "a-33-a-2001-12-12-2-1/655374"],
  ["72", "a-33-a-2001-12-12-1-1/655373"],
  ["73", "a-33-a-2001-12-14-10-1/622084"],
  ["74", "a-33-a-2001-12-14-9-1/622083"],
  ["75", "a-33-a-2001-12-14-8-1/622080"],
  ["76", "a-33-a-2001-12-14-7-1/622076"],
  ["77", "a-33-a-2001-12-14-6-1/622033"],
  ["78", "a-33-a-2001-12-15-9-1/655957"],
  ["79", "a-33-a-2001-12-15-8-1/657246"],
  ["80", "a-33-a-2001-12-15-7-1/622213"],
  ["81", "a-33-a-2001-12-15-6-1/622210"],
  ["82", "a-33-a-2001-12-15-5-1/655983"],
  ["83", "a-33-a-2001-12-18-10-1/656197"],
  ["84", "a-33-a-2001-12-18-9-1/656196"],
  ["85", "a-33-a-2001-12-18-8-1/656195"],
  ["86", "a-33-a-2001-12-18-7-1/656193"],
  ["87", "a-33-a-2001-12-18-6-1/656191"],
  ["88", "a-33-a-2001-12-19-10-1/656217"],
  ["89", "a-33-a-2001-12-19-9-1/651885"],
  ["90", "a-33-a-2001-12-19-8-1/656215"],
  ["91", "a-33-a-2001-12-19-7-1/656214"],
  ["92", "a-33-a-2001-12-19-6-1/651940"],
  ["93", "a-33-a-2001-12-22-3-1/656307"],
  ["94", "a-33-a-2001-12-22-7-1/656312"],
  ["95", "a-33-a-2001-12-22-6-1/656311"],
  ["96", "a-33-a-2001-12-22-5-1/656310"],
  ["97", "a-33-a-2001-12-22-4-1/656308"],
  ["98", "a-33-a-2001-12-22-11-1/656322"],
  ["99", "a-33-a-2001-12-22-10-1/622505"],
  ["100", "a-33-a-2001-12-22-9-1/652159"],
  ["101", "a-33-a-2001-12-22-8-1/656313"],
  ["102", "a-33-a-2001-12-08-5-1/658852"],
  ["103", "a-33-a-2001-12-15-10-1/622232"],
  ["104", "a-33-a-2001-12-22-1-1/656293"],
  ["104а", "a-33-a-2001-12-29-4-1/656740"],
];

/** Lessons whose article does not carry their own text (the recording is still theirs). */
export const TEXT_DEFECTS: Readonly<Record<string, string>> = {
  "85": "the article of lesson 85 repeats the text of lesson 86 word for word",
};

export const articleUrl = (article: string) => `${SITE}/a/${article}.html`;
export const articleId = (article: string) => article.split("/").pop() ?? article;

/** Archive folders of the recordings that are not in `2001_12` (found by GET on the archive). */
const AUDIO_FOLDERS: Readonly<Record<string, string>> = Object.fromEntries([
  ...[43, 44, 45, 95, 96, 97].map((n) => [String(n), "2001_10"]),
  ...[46, 47, 48, 49, 98, 99, 100, 101].map((n) => [String(n), "2001_11"]),
]);

/**
 * The lesson recording. Lessons 1–39 (except 9, 28, 32) have an audio article («Урок N», e.g.
 * /a/2034272.html, linked from the 2009 republications as «Читайте также») whose player streams
 * `…/MediaAssets2/russian/2001_12/Audio/mp3/russian_english_NNN.mp3`. The archive holds the files of
 * all 104 lessons under that name, in the month folder of their upload. Review lessons have none.
 */
export function audioUrl(label: string): string | undefined {
  if (!/^\d+$/.test(label)) return undefined;
  const folder = AUDIO_FOLDERS[label] ?? "2001_12";
  return `https://av.voanews.com/Videoroot/Archive/MediaAssets2/russian/${folder}/Audio/mp3/russian_english_${label.padStart(3, "0")}.mp3`;
}

export const SOURCE: CourseSource = {
  publisher: "Голос Америки (Voice of America)",
  url: SITE,
  licence: "public-domain",
};

/** For the catalogue; the size was measured on a full download. */
export const OFFERS: CourseOffer[] = [
  {
    course: COURSE,
    edition: EDITION,
    title: "Так говорят в Америке (English USA)",
    source: SOURCE,
    approxBytes: 0.31e9,
  },
];
