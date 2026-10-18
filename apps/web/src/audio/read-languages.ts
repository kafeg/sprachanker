// The languages read aloud, whose voices Settings → Speech shows: those the courses and exams here
// teach — none installed yet: those the catalogue teaches — and the interface's.
import { parseEditionId } from "@sprachanker/schema";
import { useTranslation } from "react-i18next";
import { useCatalog } from "@/api/courses.ts";

export function useReadLanguages(): string[] {
  const { i18n } = useTranslation();
  const offered = useCatalog().data ?? [];
  const here = offered.filter((o) => o.installed);
  const editions = (here.length ? here : offered).map((o) => o.edition);
  return [...new Set([...editions.map((e) => parseEditionId(e).target), i18n.language])];
}
