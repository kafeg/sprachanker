// The languages read aloud (08), whose voices Settings → Speech shows: those the courses and exams here
// teach — none installed yet: those the shown catalogue teaches — and the interface's.
import { parseEditionId } from "@sprachanker/schema";
import { useTranslation } from "react-i18next";
import { useCatalog } from "@/api/hooks.ts";
import { useShown } from "@/app/experimental.ts";

export function useReadLanguages(): string[] {
  const { i18n } = useTranslation();
  const { shown } = useShown();
  const offered = (useCatalog().data ?? []).filter((o) =>
    shown(o.kind === "exam" ? "exams" : "courses", o.series),
  );
  const here = offered.filter((o) => o.installed);
  const editions = (here.length ? here : offered).map((o) => o.edition);
  return [...new Set([...editions.map((e) => parseEditionId(e).target), i18n.language])];
}
