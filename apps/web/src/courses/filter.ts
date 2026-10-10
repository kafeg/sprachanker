// Choosing courses by language pair and course title (09): each filter offers only what fits the other
// one, so the two never combine into an empty page. Pure; the bar is filters.tsx.

/** No filter: every course, every pair. */
export const ALL = "all";
/** Where each Courses tab keeps its two filters (profile settings; nothing sets them but the bar). */
export const FILTERS = {
  mine: { course: "mine.course", pair: "mine.pair" },
  downloaded: { course: "downloaded.course", pair: "downloaded.pair" },
  available: { course: "catalog.course", pair: "catalog.pair" },
} as const;

/**
 * The items a course title and a pair let through, and what each filter can still offer. A stored
 * value the list does not have (a pair whose courses have since gone, a course since downloaded)
 * counts as no filter, so the page is never empty with a blank filter.
 */
export function filterCourses<T extends { titles: string[]; editions: string[] }>(
  items: T[],
  storedTitle: string,
  storedPair: string,
) {
  const title = items.some((i) => i.titles.includes(storedTitle)) ? storedTitle : ALL;
  const pair = items.some(
    (i) => (title === ALL || i.titles.includes(title)) && i.editions.includes(storedPair),
  )
    ? storedPair
    : ALL;
  const fitsTitle = (item: T) => title === ALL || item.titles.includes(title);
  const fitsPair = (item: T) => pair === ALL || item.editions.includes(pair);
  return {
    shown: items.filter((i) => fitsTitle(i) && fitsPair(i)),
    titles: [...new Set(items.filter(fitsPair).flatMap((i) => i.titles))].sort((a, b) =>
      a.localeCompare(b),
    ),
    pairs: [...new Set(items.filter(fitsTitle).flatMap((i) => i.editions))].sort(),
    /** The filters in force (a stored value the list lacks is none). */
    title,
    pair,
    /** A filter is set: its bar must show, so it can be cleared. */
    active: title !== ALL || pair !== ALL,
  };
}
