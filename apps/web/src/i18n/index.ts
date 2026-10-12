import { languageDir } from "@sprachanker/schema";
import i18n from "i18next";
import ICU from "i18next-icu";
import { initReactI18next } from "react-i18next";
import { catalogs } from "./catalogs.ts";
import en from "./en.json";

/** Each catalog beside English by its language code (`./ru.json` → `ru`), loaded when first needed. */
const loaders = new Map(
  Object.entries(catalogs).map(([path, load]) => [path.replace(/^.*\/|\.json$/g, ""), load]),
);

/** Languages that write language names lower case in a sentence, where Intl may give them capitalised
 *  (Greek's always; Russian, Ukrainian, Spanish, Portuguese in WebKit's). */
const LOWER_IN_SENTENCE = new Set(
  "el ru uk be bg pl cs sk sl hr bs sr ro hu fr es pt it ca".split(" "),
);

/**
 * A language's name from Intl rather than a catalog: in `locale` (its own by default: "Deutsch",
 * "Русский"), capitalised when it stands alone, else as a sentence has it ("немецкий", "γερμανικά").
 */
export function languageName(code: string, locale = code, capital = false): string {
  const name = new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code;
  if (capital) return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
  return LOWER_IN_SENTENCE.has(locale.split("-")[0] ?? "")
    ? name.charAt(0).toLocaleLowerCase(locale) + name.slice(1) // "αγγλικά Βρετανίας"
    : name;
}

/** The interface languages: English and every catalog present, in the order of their own names. */
const byName = new Intl.Collator("en");
export const UI_LANGUAGES: readonly string[] = ["en", ...loaders.keys()].sort((a, b) =>
  byName.compare(languageName(a, a, true), languageName(b, b, true)),
);

export const isUiLanguage = (code: unknown): code is string =>
  typeof code === "string" && (UI_LANGUAGES as readonly string[]).includes(code);

/** The direction a language is written in (schema's, so the e2e tests share it). */
export { languageDir };

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

/** Set when the page reloaded for a catalog that did not load; cleared once one loads. */
const RELOADED = "sprachanker.catalogReload";

/** A language's catalog, loaded; none for English (always there) or one whose chunk does not load
 *  (offline before it was cached, or the app upgraded under this open page). */
async function readCatalog(language: string) {
  const catalog = await loaders
    .get(language)?.()
    .catch(() => undefined);
  if (catalog)
    try {
      sessionStorage.removeItem(RELOADED);
    } catch {
      // Storage blocked: nothing was kept.
    }
  return catalog;
}

/** Whether a language's catalog is there, loaded first when it is not. */
async function loadCatalog(language: string): Promise<boolean> {
  if (language === "en" || i18n.hasResourceBundle(language, "translation")) return true;
  const catalog = await readCatalog(language);
  if (catalog) i18n.addResourceBundle(language, "translation", catalog);
  return !!catalog;
}

/** A catalog's chunk that does not load most likely went with an upgrade of the app under this open
 *  page: the page reloads once for the new build's; not again until a catalog has loaded. */
function reloadOnce() {
  try {
    if (sessionStorage.getItem(RELOADED)) return;
    sessionStorage.setItem(RELOADED, "1");
  } catch {
    return; // Storage blocked: no guard against reloading again and again.
  }
  location.reload();
}

/** The language asked for last: a slower catalog arriving after a later choice does not win. */
let wanted = "";

/** Switches the interface language once its catalog is loaded, and remembers it on this device;
 *  whether it switched. A catalog that does not load changes nothing (the page reloads once). */
export async function switchLanguage(language: string): Promise<boolean> {
  wanted = language;
  const loaded = await loadCatalog(language);
  if (wanted !== language) return false;
  if (!loaded) {
    reloadOnce();
    return false;
  }
  try {
    localStorage.setItem(DEVICE_LANGUAGE, language);
  } catch {
    // Storage blocked: the profile setting still keeps it.
  }
  await i18n.changeLanguage(language);
  return true;
}

const showLanguage = (language: string) => {
  document.documentElement.lang = language;
  document.documentElement.dir = languageDir(language);
};
i18n.on("languageChanged", showLanguage);

// The start language's catalog is there before the first render; one that did not load, English.
const wish = startLanguage();
const startCatalog = await readCatalog(wish);
const start = startCatalog ? wish : "en";
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
