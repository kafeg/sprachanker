// The language pairs the courses here and on offer teach (`<own>-<learnt>` editions): what the
// onboarding and Settings → Profile offer as one's own language and to learn, so a choice never
// filters the courses to nothing.
import { useCatalog, useCourses } from "@/api/hooks.ts";
import { UI_LANGUAGES } from "@/i18n/index.ts";

export function useLanguagePairs() {
  const catalog = useCatalog().data ?? [];
  const courses = useCourses().data ?? [];
  return [...new Set([...catalog.map((c) => c.edition), ...courses.flatMap((c) => c.editions)])];
}

/** The languages learnt with explanations in `native`. */
export const targetsOf = (pairs: string[], native: string) => [
  ...new Set(pairs.filter((p) => p.startsWith(`${native}-`)).map((p) => p.split("-")[1] ?? "")),
];

/** One's own language to choose: the interface's languages first, then every other language some
 *  course explains in (Nicos Weg in Turkish, Arabic, …), in the order given by `name`. */
export function nativesOf(pairs: string[], name: (code: string) => string) {
  const ui: string[] = [...UI_LANGUAGES];
  const others = [...new Set(pairs.map((p) => p.split("-")[0] ?? ""))]
    .filter((l) => l && !ui.includes(l))
    .sort((a, b) => name(a).localeCompare(name(b)));
  return [...ui, ...others];
}
