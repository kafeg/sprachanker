// Choosing courses by language pair and course title (09): each filter offers only what fits the other
// one, so the two never combine into an empty page. Unset, the pair filter is the interface language's:
// every course explained in it (`from:<lang>`), while there is one. Pure; the bar is filters.tsx.
import { parseEditionId } from "@sprachanker/schema";

/** No filter: every course, every pair. */
export const ALL = "all";
/** The pair filter "every course explained in a language". */
export const fromLang = (lang: string) => `from:${lang}`;
const FROM = /^from:(.+)$/;
/** Where each Courses tab keeps its two filters (profile settings; nothing sets them but the bar). */
export const FILTERS = {
  mine: { course: "mine.course", pair: "mine.pair" },
  downloaded: { course: "downloaded.course", pair: "downloaded.pair" },
  available: { course: "catalog.course", pair: "catalog.pair" },
} as const;

/** An edition a pair filter lets through: the pair itself, or any pair from its language. */
const passes = (pair: string, edition: string) =>
  pair === ALL || pair === edition || FROM.exec(pair)?.[1] === parseEditionId(edition).source;

/**
 * The items a course title and a pair let through, and what each filter can still offer. A stored
 * value the list does not have (a pair whose courses have since gone, a course since downloaded)
 * counts as no filter, so the page is never empty with a blank filter; an unset pair is the interface
 * language's (`uiLanguage`).
 */
export function filterCourses<T extends { titles: string[]; editions: string[] }>(
  items: T[],
  storedTitle: string,
  storedPair: string | undefined,
  uiLanguage?: string,
) {
  const title = items.some((i) => i.titles.includes(storedTitle)) ? storedTitle : ALL;
  // The interface language's default: its one pair, or all of its pairs.
  const ownPairs = [...new Set(items.flatMap((i) => i.editions))].filter(
    (e) => parseEditionId(e).source === uiLanguage,
  );
  const wanted =
    storedPair ??
    (ownPairs.length === 1 ? (ownPairs[0] as string) : uiLanguage ? fromLang(uiLanguage) : ALL);
  const pair = items.some(
    (i) => (title === ALL || i.titles.includes(title)) && i.editions.some((e) => passes(wanted, e)),
  )
    ? wanted
    : ALL;
  const fitsTitle = (item: T) => title === ALL || item.titles.includes(title);
  const fitsPair = (item: T) => item.editions.some((e) => passes(pair, e));
  const editions = [...new Set(items.filter(fitsTitle).flatMap((i) => i.editions))].sort();
  const sources = [...new Set(editions.map((e) => parseEditionId(e).source))];
  return {
    shown: items.filter((i) => fitsTitle(i) && fitsPair(i)),
    titles: [...new Set(items.filter(fitsPair).flatMap((i) => i.titles))].sort((a, b) =>
      a.localeCompare(b),
    ),
    /** Each language courses are explained in (when it has more than one pair, or is the filter in
     *  force), then each pair. */
    pairs: [
      ...sources
        .filter(
          (s) =>
            pair === fromLang(s) ||
            editions.filter((e) => parseEditionId(e).source === s).length > 1,
        )
        .map(fromLang),
      ...editions,
    ],
    /** The filters in force (a stored value the list lacks is none). */
    title,
    pair,
    /** A filter is set: its bar must show, so it can be cleared. */
    active: title !== ALL || pair !== ALL,
  };
}
