// What is experimental: every source its provider does not declare ready for learning (03), as the
// catalogue marks it — shown only when its section (courses, exams) and itself are turned on in
// Settings → Experimental. A source the catalogue does not know is shown; nothing is, until the
// catalogue has loaded (no experimental source shows for a moment).
import { useMemo } from "react";
import { useCatalog, useSetting } from "@/api/hooks.ts";

export type ExperimentalSection = "courses" | "exams";

export const sectionOn = (on: readonly string[], section: ExperimentalSection) =>
  on.includes(section);
export const sourceId = (section: ExperimentalSection, series: string) => `${section}:${series}`;

/** Whether a source's courses or exams are shown, and whether that is known yet (the catalogue). */
export function useShown() {
  const on = useSetting("experimental.on");
  const catalog = useCatalog().data;
  const experimental = useMemo(
    () => new Set((catalog ?? []).filter((o) => o.experimental).map((o) => o.series)),
    [catalog],
  );
  const shown = (section: ExperimentalSection, series: string) =>
    !!catalog &&
    (!experimental.has(series) ||
      (sectionOn(on, section) && on.includes(sourceId(section, series))));
  return { shown, ready: !!catalog };
}
export type Shown = ReturnType<typeof useShown>["shown"];
