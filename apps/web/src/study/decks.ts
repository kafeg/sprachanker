// A deck's name (Review, Decks, My words): a course's title, or a language.
import { useTranslation } from "react-i18next";
import { useCourses } from "@/api/hooks.ts";
import { languageName } from "@/i18n/index.ts";

export function useDeckName() {
  const { i18n } = useTranslation();
  const courses = useCourses().data ?? [];
  return (scope: string) => {
    if (scope.startsWith("lang:")) return languageName(scope.slice(5), i18n.language, true);
    const key = scope.slice("course:".length);
    const course = courses.find((c) => c.key === key);
    return (course && (course.titles[course.editions[0] ?? ""] || course.key)) ?? key;
  };
}
