import { expect, test } from "bun:test";
import { glossed } from "../../src/library/glossed.ts";

test("the glossary's words are found whole, in any case, the longest first, each with its translation", () => {
  const glossary = [
    { word: "Brötchen", translation: "roll" },
    { word: "Bäckerei", translation: "bakery" },
    { word: "zum Mitnehmen", translation: "to take away" },
  ];
  expect(glossed("Zwei brötchen zum Mitnehmen, bitte.", glossary)).toEqual([
    { text: "Zwei " },
    { text: "brötchen", gloss: "roll" },
    { text: " " },
    { text: "zum Mitnehmen", gloss: "to take away" },
    { text: ", bitte." },
  ]);
  // Inside another word it is not that word.
  expect(glossed("Die Bäckereien sind zu.", glossary)).toEqual([
    { text: "Die Bäckereien sind zu." },
  ]);
  expect(glossed("Hallo!", [])).toEqual([{ text: "Hallo!" }]);
});
