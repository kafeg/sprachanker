// How a pass stands, in one word: its score, in progress, or not finished.
import { useTranslation } from "react-i18next";
import { usePercent } from "@/ui/format.ts";

/** A pass's score, or how it stands when it has none. */
export function usePassMark() {
  const { t } = useTranslation();
  const percent = usePercent();
  return (p: { status: string; result: { score: number; scored: number } | null }) =>
    p.status === "active"
      ? t("notebook.open")
      : p.result?.scored
        ? percent(p.result.score)
        : p.status === "abandoned"
          ? t("notebook.unfinished")
          : "—";
}
