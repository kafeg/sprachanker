// Profile preferences applied in the UI: interface language, theme, playback speed (a course's
// edition: api/edition.ts).
import type { SettingValue } from "@sprachanker/schema";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSetSetting, useSetting, useSettings } from "@/api/settings.ts";
import { isUiLanguage, switchLanguage } from "@/i18n/index.ts";

type Theme = SettingValue<"theme">;

function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

/** Applies the profile's language (a profile without one keeps the language on screen) and theme;
 *  follows the system theme when set to "system". */
export function usePreferences() {
  const { data } = useSettings();
  const { i18n } = useTranslation();
  const { mutate } = useSetSetting();
  const language = data?.uiLanguage;
  const theme = useSetting("theme");
  useEffect(() => {
    if (!data) return;
    if (isUiLanguage(language)) {
      if (i18n.language !== language) void switchLanguage(language);
    } else mutate({ key: "uiLanguage", value: i18n.language });
  }, [data, language, i18n, mutate]);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);
}

/** The profile's playback speed for course audio, for `PlaybackRate` (ui/playback.tsx). */
export function usePlaybackRate() {
  const rate = useSetting("audioRate");
  const { mutate } = useSetSetting();
  return useMemo(
    () => ({ rate, setRate: (value: number) => mutate({ key: "audioRate", value }) }),
    [rate, mutate],
  );
}
