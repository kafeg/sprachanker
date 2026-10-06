import { expect, test } from "bun:test";
import { courseKey, lessonKey, seriesKey } from "@sprachanker/schema";
import { vocabEntries } from "../src/vocab.ts";

const lesson = lessonKey(courseKey(seriesKey("test", "series"), "a1"), 1, 2);

test("entries in source order: numbered duplicates, skipped headwords, translations when given", () => {
  const { vocab, translations, skipped } = vocabEntries(lesson, "de", [
    {
      head: { lemma: "Bank", pos: "noun", gender: "f", plural: "die Banken" },
      target: "die Bank, die Banken",
      translation: "bank",
    },
    { head: { lemma: "Bank", pos: "noun", gender: "f" }, target: "die Bank, die Bänke" },
    { head: { lemma: "…", pos: "word" }, target: "…", translation: "nothing" },
    {
      head: { lemma: "gehen", pos: "verb", forms: "geht, ging, ist gegangen" },
      target: "gehen",
      examples: ["Ich gehe."],
      translation: "to go",
      exampleTranslations: ["I go."],
    },
  ]);
  expect(vocab).toEqual([
    {
      key: `${lesson}/v-bank`,
      lexeme: "lex:de:bank:noun:f",
      target: "die Bank, die Banken",
      gender: "f",
      plural: "die Banken",
    },
    {
      key: `${lesson}/v-bank.2`,
      lexeme: "lex:de:bank:noun:f",
      target: "die Bank, die Bänke",
      gender: "f",
    },
    {
      key: `${lesson}/v-gehen`,
      lexeme: "lex:de:gehen:verb",
      target: "gehen",
      forms: "geht, ging, ist gegangen",
      examples: ["Ich gehe."],
    },
  ] as never);
  expect(translations).toEqual({
    [`${lesson}/v-bank`]: { translation: "bank" },
    [`${lesson}/v-gehen`]: { translation: "to go", examples: ["I go."] },
  });
  expect(skipped.map((s) => s.target)).toEqual(["…"]);
});
