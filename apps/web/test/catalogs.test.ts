import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ERROR_CODES } from "@sprachanker/schema";
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

// ---- Catalogs against the code: keys used, keys left over, translations missing ----

const SRC = join(import.meta.dir, "../src");
const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory()
      ? sources(path)
      : /\.(ts|tsx)$/.test(name)
        ? [readFileSync(path, "utf8")]
        : [];
  });
const code = sources(SRC).join("\n");
const english = flatten(en);
const keys = Object.keys(english);

/** Keys the code asks for by name: `t("a.b")`, `t('a.b')`. */
const asked = [...code.matchAll(/\bt\(\s*["']([a-zA-Z0-9_.-]+)["']/g)].map((m) => m[1] as string);
/** Prefixes of keys built at run time: `t(\`speech.verdict.${…}\`)`. */
const built = [...code.matchAll(/`([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_-]+)*\.)\$\{/g)].map(
  (m) => m[1] as string,
);
/** Every quoted string in the code that names a key (keys handed over as values). */
const quoted = new Set(
  [...code.matchAll(/["'`]([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_-]+)+)["'`]/g)].map((m) => m[1]),
);

test("every key the code asks for by name is in the catalogs", () => {
  const missing = [...new Set(asked)].filter((k) => !(k in english));
  expect(missing).toEqual([]);
});

test("every catalog key is used by the code (by name, handed over, or under a prefix built at run time)", () => {
  const unused = keys.filter((k) => !quoted.has(k) && !built.some((p) => k.startsWith(p)));
  expect(unused).toEqual([]);
});

/** An ICU message's parts: the arguments it takes, and its words outside them (plural branches in). */
function partsOf(message: string, lang: string) {
  const args = new Set<string>();
  let text = "";
  const walk = (elements: unknown[]) => {
    for (const el of elements as Array<{
      type: number;
      value?: unknown;
      options?: Record<string, { value: unknown[] }>;
      children?: unknown[];
    }>) {
      if (el.type === 0) text += String(el.value);
      else if (el.type !== 7 && typeof el.value === "string") args.add(el.value);
      for (const option of Object.values(el.options ?? {})) walk(option.value);
      if (el.children) walk(el.children);
    }
  };
  walk(new IntlMessageFormat(message, lang).getAst() as unknown[]);
  return { args: [...args].sort(), text };
}

/** Words the same in every language: names, abbreviations, keys. */
const SAME_EVERYWHERE = new Set(
  "PDF FSRS Ctrl JSON SprachAnker OpenRouter Groq Codex Gemini Google Claude Code Studio".split(
    " ",
  ),
);
/** German words written as the English ones; a new message the same as the English one fails until
 *  it is translated or named here. */
const SAME_IN_GERMAN = new Set([
  "settings.theme.system",
  "settings.tabs.prompts",
  "tutor.title",
  "prompt.places.tutor.name",
  "prompt.button",
  "prompt.title",
  "prompt.task.tutor",
  "player.pause",
  "player.position",
  "about.version",
  "myWords.dueIn",
  "study.flag.orange",
]);

test("ru and de translate every message (none left as the English text)", () => {
  for (const [lang, catalog] of [
    ["ru", ru],
    ["de", de],
  ] as const) {
    const flat = flatten(catalog);
    const copied = keys.filter((k) => {
      if (flat[k] !== english[k] || (lang === "de" && SAME_IN_GERMAN.has(k))) return false;
      const words = partsOf(String(english[k]), "en").text.match(/[a-zA-Z]{3,}/g) ?? [];
      return words.some((w) => !SAME_EVERYWHERE.has(w));
    });
    expect(copied, lang).toEqual([]);
  }
});

test("ru and de take the same arguments as en in every message", () => {
  for (const [lang, catalog] of [
    ["ru", ru],
    ["de", de],
  ] as const) {
    const flat = flatten(catalog);
    const differ = keys.filter(
      (k) =>
        JSON.stringify(partsOf(String(flat[k]), lang).args) !==
        JSON.stringify(partsOf(String(english[k]), "en").args),
    );
    expect(differ, lang).toEqual([]);
  }
});

test("every error the API answers with has its words, and no words are kept for codes it no longer has", () => {
  const codes = Object.keys(en.error).filter((k) => k !== "other");
  expect(codes.sort()).toEqual([...ERROR_CODES].sort());
});
