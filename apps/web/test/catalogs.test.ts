import { expect, test } from "bun:test";
import { IntlMessageFormat } from "intl-messageformat";
import de from "../src/i18n/de.json";
import en from "../src/i18n/en.json";
import ru from "../src/i18n/ru.json";

const catalogs = { en, ru, de };

/** Flattens a nested catalog to { "a.b": message }. */
function flatten(node: object, prefix = ""): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(node).flatMap(([key, value]) =>
      typeof value === "object" && value !== null
        ? Object.entries(flatten(value, `${prefix}${key}.`))
        : [[`${prefix}${key}`, value]],
    ),
  );
}

test("en, ru and de catalogs have the same keys", () => {
  const keys = Object.entries(catalogs).map(([lang, catalog]) => [
    lang,
    Object.keys(flatten(catalog)).sort(),
  ]);
  const english = keys[0]?.[1];
  for (const [, langKeys] of keys) expect(langKeys).toEqual(english);
});

test("every message is a valid ICU string", () => {
  for (const [lang, catalog] of Object.entries(catalogs)) {
    for (const [key, message] of Object.entries(flatten(catalog))) {
      expect(typeof message, `${lang}:${key}`).toBe("string");
      expect(() => new IntlMessageFormat(message as string, lang), `${lang}:${key}`).not.toThrow();
    }
  }
});
