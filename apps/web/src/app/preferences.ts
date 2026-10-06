// Profile preferences applied in the UI: interface language, theme, course edition, playback speed.
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSetSetting, useSettings } from "@/api/hooks.ts";
import { isUiLanguage } from "@/i18n/index.ts";

export type Theme = "system" | "light" | "dark";

function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

/** Applies the stored language and theme; follows the system theme when set to "system". */
export function usePreferences() {
  const { data } = useSettings();
  const { i18n } = useTranslation();
  const language = data?.uiLanguage;
  const theme = (data?.theme as Theme | undefined) ?? "system";
  useEffect(() => {
    if (isUiLanguage(language) && i18n.language !== language) void i18n.changeLanguage(language);
  }, [language, i18n]);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);
}

/** The profile's playback speed for course audio, for `PlaybackRate` (ui/media.tsx). */
export function usePlaybackRate() {
  const { data } = useSettings();
  const set = useSetSetting();
  const stored = data?.audioRate;
  const rate = typeof stored === "number" ? stored : 1;
  const { mutate } = set;
  return useMemo(
    () => ({ rate, setRate: (value: number) => mutate({ key: "audioRate", value }) }),
    [rate, mutate],
  );
}

export const editionSetting = (series: string, course: string) => `edition:${series}/${course}`;

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
