// The interface catalogs (spec 10, i18n): every `src/i18n/<code>.json` present is checked against the
// English one and against the code — a catalog added is covered without touching this file.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ERROR_CODES, Lang } from "@sprachanker/schema";
import { IntlMessageFormat } from "intl-messageformat";
import en from "../src/i18n/en.json";

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

const I18N = join(import.meta.dir, "../src/i18n");
/** Every catalog present, flattened, by language code (English first). */
const catalogs = Object.fromEntries(
  readdirSync(I18N)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .sort((a, b) => (a === "en" ? -1 : b === "en" ? 1 : a.localeCompare(b)))
    .map((lang) => [lang, flatten(JSON.parse(readFileSync(join(I18N, `${lang}.json`), "utf8")))]),
);
const english = flatten(en);
const keys = Object.keys(english);
/** The catalogs beside English. */
const others = Object.entries(catalogs).filter(([lang]) => lang !== "en");

test("every catalog is named by a language code the profile keeps and Intl names", () => {
  expect(Object.keys(catalogs)).toContain("en");
  for (const lang of Object.keys(catalogs)) {
    expect(Lang.safeParse(lang).success, lang).toBe(true);
    const name = new Intl.DisplayNames([lang], { type: "language" }).of(lang);
    expect(name && name !== lang, lang).toBe(true);
  }
});

test("every catalog has the keys of the English one", () => {
  for (const [lang, flat] of others)
    expect(Object.keys(flat).sort(), lang).toEqual([...keys].sort());
});

test("every message is a valid ICU string", () => {
  for (const [lang, flat] of Object.entries(catalogs)) {
    for (const [key, message] of Object.entries(flat)) {
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

type Element = {
  type: number;
  value?: unknown;
  options?: Record<string, { value: unknown[] }>;
  pluralType?: "cardinal" | "ordinal";
  children?: unknown[];
};
/** intl-messageformat's element types used here. */
const LITERAL = 0;
const PLURAL = 6;
const POUND = 7;

/** An ICU message's parts: the arguments it takes, its words outside them (plural branches in), and
 *  each plural's kind and categories. */
function partsOf(message: string, lang: string) {
  const args = new Set<string>();
  const plurals: Array<{ arg: string; type: "cardinal" | "ordinal"; categories: string[] }> = [];
  let text = "";
  const walk = (elements: unknown[]) => {
    for (const el of elements as Element[]) {
      if (el.type === LITERAL) text += String(el.value);
      else if (el.type !== POUND && typeof el.value === "string") args.add(el.value);
      if (el.type === PLURAL)
        plurals.push({
          arg: String(el.value),
          type: el.pluralType ?? "cardinal",
          categories: Object.keys(el.options ?? {}),
        });
      for (const option of Object.values(el.options ?? {})) walk(option.value);
      if (el.children) walk(el.children);
    }
  };
  walk(new IntlMessageFormat(message, lang).getAst() as unknown[]);
  return { args: [...args].sort(), text, plurals };
}

test("every plural has `other` and only categories its language has (exact `=n` cases aside)", () => {
  const wrong: string[] = [];
  for (const [lang, flat] of Object.entries(catalogs)) {
    const has = {
      cardinal: new Intl.PluralRules(lang).resolvedOptions().pluralCategories as string[],
      ordinal: new Intl.PluralRules(lang, { type: "ordinal" }).resolvedOptions()
        .pluralCategories as string[],
    };
    for (const [key, message] of Object.entries(flat))
      for (const plural of partsOf(String(message), lang).plurals) {
        const foreign = plural.categories.filter(
          (c) => !c.startsWith("=") && !has[plural.type].includes(c),
        );
        if (!plural.categories.includes("other") || foreign.length)
          wrong.push(`${lang}:${key} {${plural.arg}}: ${plural.categories.join(" ")}`);
      }
  }
  expect(wrong).toEqual([]);
});

/** Words the same in every language: names, abbreviations, keys. */
const SAME_EVERYWHERE = new Set(
  "PDF FSRS Ctrl JSON SprachAnker OpenRouter Groq Codex Gemini Google Claude Code Studio".split(
    " ",
  ),
);
/** Per language, the messages written as the English ones; a new message the same as the English one
 *  fails until it is translated or named here under its language. */
const SAME_AS_ENGLISH: Record<string, string[]> = {
  de: [
    "settings.theme.system",
    "settings.prompts",
    "tutor.title",
    "prompt.places.tutor.name",
    "prompt.button",
    "prompt.title",
    "prompt.titleOf",
    "prompt.task.tutor",
    "player.pause",
    "player.position",
    "about.version",
    "myWords.dueIn",
    "decks.import.name",
    "study.flag.orange",
    // Federal states whose German names English keeps.
    ...["bw", "be", "bb", "hb", "hh", "sl", "sh"].map((s) => `exams.states.${s}`),
  ],
};

test("every catalog translates every message (none left as the English text)", () => {
  for (const [lang, flat] of others) {
    const same = new Set(SAME_AS_ENGLISH[lang]);
    const copied = keys.filter((k) => {
      if (flat[k] !== english[k] || same.has(k)) return false;
      const words = partsOf(String(english[k]), "en").text.match(/[a-zA-Z]{3,}/g) ?? [];
      return words.some((w) => !SAME_EVERYWHERE.has(w));
    });
    expect(copied, lang).toEqual([]);
  }
});

test("every catalog's messages take the same arguments as the English ones", () => {
  for (const [lang, flat] of others) {
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
