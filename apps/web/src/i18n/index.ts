import i18n from "i18next";
import ICU from "i18next-icu";
import { initReactI18next } from "react-i18next";
import de from "./de.json";
import en from "./en.json";
import ru from "./ru.json";

export const UI_LANGUAGES = ["en", "ru", "de"] as const;
type UiLanguage = (typeof UI_LANGUAGES)[number];

export const isUiLanguage = (code: unknown): code is UiLanguage =>
  (UI_LANGUAGES as readonly unknown[]).includes(code);

/** Where this device keeps the interface language chosen last (before any profile is signed in, and
 *  so a reload starts in it); the profile keeps its own (`uiLanguage`). */
const DEVICE_LANGUAGE = "sprachanker.uiLanguage";

/** The language chosen on this device, else the first supported one of the browser, else English. */
function startLanguage(): UiLanguage {
  try {
    const chosen = localStorage.getItem(DEVICE_LANGUAGE);
    if (isUiLanguage(chosen)) return chosen;
  } catch {
    // Storage blocked: the browser's language.
  }
  const codes = navigator.languages.map((tag) => tag.split("-")[0] ?? "");
  return codes.find(isUiLanguage) ?? "en";
}

/** Switches the interface language and remembers it on this device. */
export function switchLanguage(language: UiLanguage) {
  void i18n.changeLanguage(language);
  try {
    localStorage.setItem(DEVICE_LANGUAGE, language);
  } catch {
    // Storage blocked: the profile setting still keeps it.
  }
}

/**
 * A language's name from Intl rather than a catalog: in `locale` (its own by default: "Deutsch",
 * "Русский"), capitalised when it stands alone (Russian names are lower case in a sentence).
 */
export function languageName(code: string, locale = code, capital = false): string {
  const name = new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code;
  return capital ? name.charAt(0).toLocaleUpperCase(locale) + name.slice(1) : name;
}

i18n.on("languageChanged", (language) => {
  document.documentElement.lang = language;
});

await i18n
  .use(ICU)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, ru: { translation: ru }, de: { translation: de } },
    lng: startLanguage(),
    fallbackLng: "en",
    supportedLngs: UI_LANGUAGES,
    interpolation: { escapeValue: false },
  });

export default i18n;
