import i18n from "i18next";
import ICU from "i18next-icu";
import { initReactI18next } from "react-i18next";
import de from "./de.json";
import en from "./en.json";
import ru from "./ru.json";

export const UI_LANGUAGES = ["en", "ru", "de"] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

const isUiLanguage = (code: string): code is UiLanguage =>
  (UI_LANGUAGES as readonly string[]).includes(code);

/** First supported language from the browser preferences; English otherwise. */
function preferredLanguage(): UiLanguage {
  const codes = navigator.languages.map((tag) => tag.split("-")[0] ?? "");
  return codes.find(isUiLanguage) ?? "en";
}

i18n.on("languageChanged", (language) => {
  document.documentElement.lang = language;
});

await i18n
  .use(ICU)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, ru: { translation: ru }, de: { translation: de } },
    lng: preferredLanguage(),
    fallbackLng: "en",
    supportedLngs: UI_LANGUAGES,
    interpolation: { escapeValue: false },
  });
