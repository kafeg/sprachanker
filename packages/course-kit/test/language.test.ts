import { expect, test } from "bun:test";
import { inLearnerLanguage } from "../src/language.ts";

test("a text mostly in the learner's script is the learner's; else the target's", () => {
  expect(inLearnerLanguage("Они хорошо знакомы.", "de", "ru")).toBe(true);
  expect(inLearnerLanguage("Lisa und Kerstin…", "de", "ru")).toBe(false);
  // German with a Russian word in brackets: German.
  expect(inLearnerLanguage("Guten Morgen, Frau Schröder (утро)!", "de", "ru")).toBe(false);
  expect(inLearnerLanguage("السيد روسي يأكل البيتزا", "de", "ar")).toBe(true);
});

test("two languages of one script are not told apart: the text stays the target's", () => {
  expect(inLearnerLanguage("Muchos italianos comen pizza.", "de", "es")).toBe(false);
  expect(inLearnerLanguage("Good morning!", "en", "en")).toBe(false);
});
