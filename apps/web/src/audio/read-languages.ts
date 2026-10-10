// The languages read aloud (08), whose voices Settings → Speech shows: those the courses and exams here
// teach — none installed yet: those the shown catalogue teaches — and the interface's.
import { parseEditionId } from "@sprachanker/schema";
import { useTranslation } from "react-i18next";
import { useCatalog, useCourses } from "@/api/hooks.ts";
import { useShown } from "@/app/experimental.ts";

export function useReadLanguages(): string[] {
  const { i18n } = useTranslation();
  const courses = useCourses().data ?? [];
  const catalog = useCatalog().data ?? [];
  const { shown } = useShown();
  const editions = courses.length
    ? courses.flatMap((c) => c.editions)
    : catalog
        .filter((o) => shown(o.kind === "exam" ? "exams" : "courses", o.series))
        .map((o) => o.edition);
  return [...new Set([...editions.map((e) => parseEditionId(e).target), i18n.language])];
}
