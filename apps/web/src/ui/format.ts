// Numbers and dates in the interface language: one place for each format the screens show.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

const DATE: Record<
  "day" | "dayTime" | "month" | "monthYear" | "weekday" | "time",
  Intl.DateTimeFormatOptions
> = {
  day: { day: "numeric", month: "short" },
  dayTime: { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" },
  // Gregorian whatever the language's own calendar (Persian's): the months stand over Gregorian weeks.
  month: { month: "short", calendar: "gregory" },
  monthYear: { month: "short", year: "numeric", calendar: "gregory" },
  weekday: { weekday: "short" },
  time: { hour: "numeric", minute: "2-digit" },
};

/** A date as a day ("7 Oct"), a day with its time ("7 Oct, 15:28"), its Gregorian month ("Oct"), with
 *  its year ("Oct 2026"), its weekday ("Mon") or its time of day ("15:28"). */
export function useDateFormat(kind: keyof typeof DATE) {
  const { i18n } = useTranslation();
  return useMemo(() => new Intl.DateTimeFormat(i18n.language, DATE[kind]), [i18n.language, kind]);
}

/** The day a week starts on where the language is spoken (0 Sunday … 6 Saturday, as `Date.getDay`):
 *  Intl's week info (Sunday in English, Saturday in Persian and Arabic), else Monday. */
export function firstDayOfWeek(language: string): number {
  try {
    const locale = new Intl.Locale(language) as Intl.Locale & {
      getWeekInfo?(): { firstDay?: number };
      weekInfo?: { firstDay?: number };
    };
    const day = (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay;
    if (day) return day % 7;
  } catch {
    // Not a language tag: Monday.
  }
  return 1;
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

/** A number with one decimal ("4.2" gigabytes). */
export function useDecimal() {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const format = new Intl.NumberFormat(i18n.language, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    return (value: number) => format.format(value);
  }, [i18n.language]);
}

/** A large count briefly ("128K", "1.5K" tokens of context). */
export function useCompact() {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const format = new Intl.NumberFormat(i18n.language, {
      notation: "compact",
      maximumFractionDigits: 1,
    });
    return (value: number) => format.format(value);
  }, [i18n.language]);
}

/** A length as a clock: 75 s → "1:15"; unknown → "--:--". */
export const clock = (seconds: number) => {
  if (!Number.isFinite(seconds)) return "--:--";
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** About how long something takes: whole minutes (at least one), hours from 90 minutes on ("5
 *  minutes", "2 hours"). */
export function useDuration() {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const unit = (u: "minute" | "hour") =>
      new Intl.NumberFormat(i18n.language, { style: "unit", unit: u, unitDisplay: "long" });
    const minutes = unit("minute");
    const hours = unit("hour");
    return (ms: number) => {
      const m = Math.max(1, Math.round(ms / 60_000));
      return m < 90 ? minutes.format(m) : hours.format(Math.round(m / 60));
    };
  }, [i18n.language]);
}

/** A short time in seconds ("12 s"), as long as a card's answer takes. */
export function useSeconds() {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const format = new Intl.NumberFormat(i18n.language, { style: "unit", unit: "second" });
    return (ms: number) => format.format(Math.round(ms / 1000));
  }, [i18n.language]);
}
