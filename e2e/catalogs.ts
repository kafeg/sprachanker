// The interface catalogs present (apps/web/src/i18n/<code>.json), for tests that go through every
// language: each language's code, direction and a plain message by key.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const I18N = join(import.meta.dirname, "../apps/web/src/i18n");

/** Right to left where Intl says so (as the app's `languageDir`). */
const direction = (lang: string) =>
  (
    new Intl.Locale(lang) as Intl.Locale & { getTextInfo?(): { direction?: string } }
  ).getTextInfo?.().direction === "rtl" || ["ar", "fa", "he", "ur"].includes(lang)
    ? "rtl"
    : "ltr";

export const catalogs = readdirSync(I18N)
  .filter((name) => name.endsWith(".json"))
  .map((name) => {
    const lang = name.slice(0, -".json".length);
    const catalog = JSON.parse(readFileSync(join(I18N, name), "utf8")) as Record<string, unknown>;
    /** A message without arguments, by its dotted key. */
    const msg = (key: string) =>
      String(
        key.split(".").reduce<unknown>((node, k) => (node as Record<string, unknown>)[k], catalog),
      );
    return { lang, dir: direction(lang), msg };
  });
