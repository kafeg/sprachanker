import i18n from "i18next";
import ICU from "i18next-icu";
import { initReactI18next } from "react-i18next";
import { catalogs } from "./catalogs.ts";
import en from "./en.json";

/** Each catalog beside English by its language code (`./ru.json` → `ru`), loaded when first needed. */
const loaders = new Map(
  Object.entries(catalogs).map(([path, load]) => [path.replace(/^.*\/|\.json$/g, ""), load]),
);

/**
 * A language's name from Intl rather than a catalog: in `locale` (its own by default: "Deutsch",
 * "Русский"), capitalised when it stands alone (Russian names are lower case in a sentence).
 */
export function languageName(code: string, locale = code, capital = false): string {
  const name = new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code;
  return capital ? name.charAt(0).toLocaleUpperCase(locale) + name.slice(1) : name;
}

/** The interface languages: English and every catalog present, in the order of their own names (09). */
const byName = new Intl.Collator("en");
export const UI_LANGUAGES: readonly string[] = ["en", ...loaders.keys()].sort((a, b) =>
  byName.compare(languageName(a, a, true), languageName(b, b, true)),
);

export const isUiLanguage = (code: unknown): code is string =>
  typeof code === "string" && (UI_LANGUAGES as readonly string[]).includes(code);

/** Scripts written right to left, where Intl cannot tell (no `Intl.Locale` text info). */
const RIGHT_TO_LEFT = new Set(["ar", "fa", "he", "ur", "ps", "sd", "yi", "dv", "ckb", "ug"]);

/** The direction a language is written in: from Intl where it knows, else the list above. */
export function languageDir(code: string): "ltr" | "rtl" {
  try {
    const locale = new Intl.Locale(code) as Intl.Locale & {
      getTextInfo?(): { direction?: string };
      textInfo?: { direction?: string };
    };
    const direction = (locale.getTextInfo?.() ?? locale.textInfo)?.direction;
    if (direction === "ltr" || direction === "rtl") return direction;
  } catch {
    // Not a language tag: the list.
  }
  return RIGHT_TO_LEFT.has(code.split("-")[0] ?? "") ? "rtl" : "ltr";
}

/** Where this device keeps the interface language chosen last (before any profile is signed in, and
 *  so a reload starts in it); the profile keeps its own (`uiLanguage`). */
const DEVICE_LANGUAGE = "sprachanker.uiLanguage";

/** The language chosen on this device, else the first supported one of the browser, else English. */
function startLanguage(): string {
  try {
    const chosen = localStorage.getItem(DEVICE_LANGUAGE);
    if (isUiLanguage(chosen)) return chosen;
  } catch {
    // Storage blocked: the browser's language.
  }
  const codes = navigator.languages.map((tag) => tag.split("-")[0] ?? "");
  return codes.find(isUiLanguage) ?? "en";
}

/** A language's catalog, loaded; none for English (always there) or one that fails to load (offline
 *  before its chunk was cached): English stands in. */
async function readCatalog(language: string) {
  try {
    return await loaders.get(language)?.();
  } catch {
    return undefined;
  }
}

async function loadCatalog(language: string) {
  if (i18n.hasResourceBundle(language, "translation")) return;
  const catalog = await readCatalog(language);
  if (catalog) i18n.addResourceBundle(language, "translation", catalog);
}

/** The language asked for last: a slower catalog arriving after a later choice does not win. */
let wanted = "";

/** Switches the interface language once its catalog is loaded, and remembers it on this device. */
export async function switchLanguage(language: string) {
  wanted = language;
  try {
    localStorage.setItem(DEVICE_LANGUAGE, language);
  } catch {
    // Storage blocked: the profile setting still keeps it.
  }
  await loadCatalog(language);
  if (wanted === language) await i18n.changeLanguage(language);
}

const showLanguage = (language: string) => {
  document.documentElement.lang = language;
  document.documentElement.dir = languageDir(language);
};
i18n.on("languageChanged", showLanguage);

// The start language's catalog is there before the first render.
const start = startLanguage();
const startCatalog = await readCatalog(start);
await i18n
  .use(ICU)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ...(startCatalog && { [start]: { translation: startCatalog } }),
    },
    partialBundledLanguages: true,
    lng: start,
    fallbackLng: "en",
    supportedLngs: UI_LANGUAGES,
    interpolation: { escapeValue: false },
  });

export default i18n;
