import { expect, test } from "bun:test";
import { inLearnerLanguage } from "../src/language.ts";

test("a text in the learner's script is the learner's; the target's script is the target's", () => {
  expect(inLearnerLanguage("Они хорошо знакомы.", "de", "ru")).toBe(true);
  expect(inLearnerLanguage("Lisa und Kerstin…", "de", "ru")).toBe(false);
  // Mostly German with a Russian word in brackets: German.
  expect(inLearnerLanguage("Guten Morgen, Frau Schröder (утро)!", "de", "ru")).toBe(false);
  expect(inLearnerLanguage("السيد روسي يأكل البيتزا", "de", "ar")).toBe(true);
});

test("two languages in one script: taken as the learner's only when it says so twice over", () => {
  expect(inLearnerLanguage("Muchos de los italianos comen pizza y pasta.", "de", "es")).toBe(true);
  expect(inLearnerLanguage("Is it very good today?", "de", "en")).toBe(true);
  // Words German shares with them, or one letter, say nothing.
  expect(inLearnerLanguage("Wann ruft Tarek wieder an?", "de", "en")).toBe(false);
  expect(inLearnerLanguage("Am Dienstag um 18:00 Uhr.", "de", "pt")).toBe(false);
  expect(inLearnerLanguage("Hey, Lena! Na, wie geht’s?", "de", "bs")).toBe(false);
  // A name, a number: the target's.
  expect(inLearnerLanguage("Herr Rossi", "de", "en")).toBe(false);
});

test("one language for both, or nothing to read: the target's", () => {
  expect(inLearnerLanguage("Good morning!", "en", "en")).toBe(false);
  expect(inLearnerLanguage("  ", "de", "ru")).toBe(false);
});
