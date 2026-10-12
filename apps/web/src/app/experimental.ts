// What is experimental: every course its provider does not declare ready for learning, as the
// catalogue marks it — shown only when its section (courses, exams) and its source are turned on in
// Settings → General → Experimental. A source the catalogue does not know is shown; nothing is, until the
// catalogue has loaded or failed (no experimental source shows for a moment).
import { useMemo } from "react";
import { useCatalog } from "@/api/courses.ts";
import { useSetting } from "@/api/settings.ts";

export type ExperimentalSection = "courses" | "exams";

export const sectionOn = (on: readonly string[], section: ExperimentalSection) =>
  on.includes(section);
export const sourceId = (section: ExperimentalSection, series: string) => `${section}:${series}`;

/** Whether a source's courses or exams are shown (a course of it, or the source as a whole: any of
 *  its courses ready), and whether that is known yet (the catalogue). */
export function useShown() {
  const on = useSetting("experimental.on");
  const catalog = useCatalog();
  const { experimental, ready: readyOnes } = useMemo(() => {
    const offers = catalog.data ?? [];
    return {
      // Courses not ready for learning, by series and course.
      experimental: new Set(
        offers.filter((o) => o.experimental).map((o) => `${o.series}/${o.course}`),
      ),
      // Sources with a course ready.
      ready: new Set(offers.filter((o) => !o.experimental).map((o) => o.series)),
    };
  }, [catalog.data]);
  // A catalogue that fails to load marks nothing experimental: the installed lists still show.
  const known = !!catalog.data || catalog.isError;
  const shown = (section: ExperimentalSection, series: string, course?: string) =>
    known &&
    ((course
      ? !experimental.has(`${series}/${course}`)
      : readyOnes.has(series) || ![...experimental].some((k) => k.startsWith(`${series}/`))) ||
      (sectionOn(on, section) && on.includes(sourceId(section, series))));
  return { shown, ready: known };
}
export type Shown = ReturnType<typeof useShown>["shown"];

/** What a section offers to download: its kind of offer (exams in Exams, courses in Courses), not
 *  installed, shown. */
export const offersOf = <
  T extends { installed: boolean; kind?: string; series: string; course: string },
>(
  catalog: T[] | undefined,
  section: ExperimentalSection,
  shown: Shown,
) =>
  (catalog ?? []).filter(
    (o) =>
      !o.installed &&
      (o.kind === "exam") === (section === "exams") &&
      shown(section, o.series, o.course),
  );
