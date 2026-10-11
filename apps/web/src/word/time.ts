// When cards come back, in the learner's language: Anki's interval text, and a card's next due.
import { dueIn, intervalText } from "@sprachanker/engine";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

/** An interval as Anki writes it ("<10m", "4d", "1.2mo"), in the language's digits; a unit that is a
 *  word starts with a no-break space in its catalog ("4 روز"). */
export function useIntervalText() {
  const { t, i18n } = useTranslation();
  const number = useMemo(
    () => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }),
    [i18n.language],
  );
  return (ms: number) =>
    intervalText(
      ms,
      {
        s: t("study.unit.s"),
        m: t("study.unit.m"),
        h: t("study.unit.h"),
        d: t("study.unit.d"),
        mo: t("study.unit.mo"),
        y: t("study.unit.y"),
      },
      number.format,
    );
}

/** When a card or a word is next due: "—" (not studied, or suspended), now, or in how long. */
export function useDueText() {
  const { t } = useTranslation();
  const interval = useIntervalText();
  return (due: number | null, now = Date.now()) => {
    const left = dueIn(due, now);
    return left === null
      ? "—"
      : left === 0
        ? t("myWords.dueNow")
        : t("myWords.dueIn", { interval: interval(left) });
  };
}
