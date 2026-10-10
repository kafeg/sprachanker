// The edition a course is shown in (02, "Editions"): the profile's choice for it, else the one
// explaining in the interface language, else the first — what a course's page and its lessons open with.
import { editionSetting } from "@sprachanker/schema";
import { useTranslation } from "react-i18next";
import { isUiLanguage } from "@/i18n/index.ts";
import { useCourses } from "./courses.ts";
import { useSettings } from "./settings.ts";

/** The edition to show: the stored choice, else the one explaining in the UI language, else the first. */
export function useEdition(
  series: string,
  course: string,
  editions: string[] | undefined,
): string | undefined {
  const { data } = useSettings();
  const { i18n } = useTranslation();
  // Wait for the profile settings, so a run never starts in a guessed edition.
  if (!editions?.length || !data) return undefined;
  const stored = data[editionSetting(series, course)];
  if (typeof stored === "string" && editions.includes(stored)) return stored;
  const language = isUiLanguage(data.uiLanguage) ? data.uiLanguage : i18n.language;
  return editions.find((e) => e.startsWith(`${language}-`)) ?? editions[0];
}

/** An installed course and the edition to show it in (`useEdition`): what a course's page and its
 *  lessons open with. `courses` is the list query (pending while it loads). */
export function useCourseEdition(series: string, course: string) {
  const courses = useCourses();
  const info = courses.data?.find((c) => c.series === series && c.course === course);
  return { courses, info, edition: useEdition(series, course, info?.editions) };
}
