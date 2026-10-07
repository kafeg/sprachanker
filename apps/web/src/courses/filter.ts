// Choosing courses by language pair and course title (09): each filter offers only what fits the other
// one, so the two never combine into an empty page. Pure; the bar is filters.tsx.

/** No filter: every course, every pair. */
export const ALL = "all";
/** Where each page keeps its two filters (profile settings). */
export const CATALOG_FILTERS = { course: "catalog.course", pair: "catalog.pair" };
export const MY_FILTERS = { course: "mine.course", pair: "mine.pair" };

/** The items a course title and a pair let through, and what each filter can still offer. */
export function filterCourses<T extends { titles: string[]; editions: string[] }>(
  items: T[],
  title: string,
  pair: string,
) {
  const fitsTitle = (item: T) => title === ALL || item.titles.includes(title);
  const fitsPair = (item: T) => pair === ALL || item.editions.includes(pair);
  return {
    shown: items.filter((i) => fitsTitle(i) && fitsPair(i)),
    titles: [...new Set(items.filter(fitsPair).flatMap((i) => i.titles))].sort((a, b) =>
      a.localeCompare(b),
    ),
    pairs: [...new Set(items.filter(fitsTitle).flatMap((i) => i.editions))].sort(),
    /** A filter is set: its bar must show, so it can be cleared. */
    active: title !== ALL || pair !== ALL,
  };
}
