// Numbers and dates in the interface language: one place for each format the screens show.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

const DATE: Record<"day" | "dayTime" | "month" | "weekday", Intl.DateTimeFormatOptions> = {
  day: { day: "numeric", month: "short" },
  dayTime: { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" },
  month: { month: "short" },
  weekday: { weekday: "short" },
};

/** A date as a day ("7 Oct"), a day with its time ("7 Oct, 15:28"), its month ("Oct") or its
 *  weekday ("Mon"). */
export function useDateFormat(kind: keyof typeof DATE) {
  const { i18n } = useTranslation();
  return useMemo(() => new Intl.DateTimeFormat(i18n.language, DATE[kind]), [i18n.language, kind]);
}

/** A count as the language writes it ("1,234"; "1 234"). */
export function useNumber() {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const format = new Intl.NumberFormat(i18n.language);
    return (value: number) => format.format(value);
  }, [i18n.language]);
}

/** A share 0..1 as a percentage. */
export function usePercent() {
  const { i18n } = useTranslation();
  const format = useMemo(
    () => new Intl.NumberFormat(i18n.language, { style: "percent" }),
    [i18n.language],
  );
  return (share: number) => format.format(share);
}

/** Bytes as MB or GB. */
export function useBytes() {
  const { i18n } = useTranslation();
  return (bytes: number) => {
    const giga = bytes >= 1e9;
    return new Intl.NumberFormat(i18n.language, {
      style: "unit",
      unit: giga ? "gigabyte" : "megabyte",
      maximumFractionDigits: giga ? 1 : 0,
    }).format(bytes / (giga ? 1e9 : 1e6));
  };
}

/** US dollars, as model prices and credits are given ("$0.42"; small prices with more digits). */
export function useDollars() {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const format = new Intl.NumberFormat(i18n.language, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 3,
    });
    return (value: number) => format.format(value);
  }, [i18n.language]);
}

/** A large count briefly ("128K" tokens of context). */
export function useCompact() {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const format = new Intl.NumberFormat(i18n.language, { notation: "compact" });
    return (value: number) => format.format(value);
  }, [i18n.language]);
}
