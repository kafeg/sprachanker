// The language pairs the courses here and on offer teach (`<own>-<learnt>` editions): what the
// onboarding and Settings → Profile offer to learn, so a choice never filters the courses to nothing.
import { useCatalog, useCourses } from "@/api/hooks.ts";

export function useLanguagePairs() {
  const catalog = useCatalog().data ?? [];
  const courses = useCourses().data ?? [];
  return [...new Set([...catalog.map((c) => c.edition), ...courses.flatMap((c) => c.editions)])];
}

/** The languages learnt with explanations in `native`. */
export const targetsOf = (pairs: string[], native: string) => [
  ...new Set(pairs.filter((p) => p.startsWith(`${native}-`)).map((p) => p.split("-")[1] ?? "")),
];
