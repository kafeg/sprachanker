// What is experimental (owner, 2026-10-10): every source but DW Nicos Weg and BAMF Leben in
// Deutschland, as the server marks its catalogue — shown only when its section (courses, exams) and
// itself are turned on in Settings → Experimental. A source the catalogue does not know is shown.
import { useMemo } from "react";
import { useCatalog, useSetting } from "@/api/hooks.ts";

export type ExperimentalSection = "courses" | "exams";

export const sectionOn = (on: readonly string[], section: ExperimentalSection) =>
  on.includes(section);
export const sourceId = (section: ExperimentalSection, series: string) => `${section}:${series}`;

/** Whether a source's courses or exams are shown. */
export function useShown() {
  const on = useSetting("experimental.on");
  const catalog = useCatalog().data;
  const experimental = useMemo(
    () => new Set((catalog ?? []).filter((o) => o.experimental).map((o) => o.series)),
    [catalog],
  );
  return (section: ExperimentalSection, series: string) =>
    !experimental.has(series) || (sectionOn(on, section) && on.includes(sourceId(section, series)));
}
