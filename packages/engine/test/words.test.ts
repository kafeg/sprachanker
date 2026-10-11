import { expect, test } from "bun:test";
import { hasForm, markWords, sameWord, usesWord, wordForms } from "../src/text/words.ts";

test("a word's forms: headword, plural and forms, without what is in brackets", () => {
  expect(wordForms({ target: "die Frau, die Frauen" })).toEqual(["die", "frau", "frauen"]);
  expect(
    wordForms({ target: "(etwas) studieren", forms: "studiert, studierte, hat studiert" }),
  ).toEqual(["studieren", "studiert", "studierte", "hat"]);
});

test("a written word is a form when it shares the stem; short words only when the same", () => {
  expect(
    ["wohne", "Heißt", "Kaffees", "arbeitet"].map((w, i) =>
      sameWord(w, ["wohnen", "heißen", "kaffee", "arbeiten"][i] as string),
    ),
  ).toEqual([true, true, true, true]);
  expect(sameWord("ich", "ich")).toBe(true);
  expect(sameWord("in", "im")).toBe(false);
  expect(sameWord("Wohnung", "wohnen")).toBe(false);
});

test("a sentence uses the word by its main part, not by its article", () => {
  const frau = { target: "die Frau, die Frauen" };
  expect(usesWord("Die Frau trinkt Kaffee.", frau)).toBe(true);
  expect(usesWord("Die Frauen sind hier.", frau)).toBe(true);
  expect(usesWord("Die Lehrerin ist nett.", frau)).toBe(false);
  expect(usesWord("Ich bin hier.", { target: "ich" })).toBe(true);
});

test("a form no ending rule finds: each of its words in the sentence, case aside", () => {
  expect(usesWord("Er ist zu Hause.", { target: "sein" })).toBe(false);
  expect(hasForm("Er ist zu Hause.", "ist")).toBe(true);
  expect(hasForm("Er lädt mich heute ein.", "lädt ein")).toBe(true);
  expect(hasForm("Er lädt mich heute.", "lädt ein")).toBe(false);
  expect(hasForm("Er kann schwimmen.", "kannst")).toBe(false);
  expect(hasForm("Er kann schwimmen.", "")).toBe(false);
});

test("new words are marked, with the translation of the first glossary that has them", () => {
  const segments = markWords(
    "Ich wohne in Berlin, Frau Klein.",
    [{ target: "ich" }, { target: "wohnen" }, { target: "in" }],
    [
      { target: "die Frau", translation: "женщина" },
      { target: "Frau", translation: "госпожа" },
    ],
  );
  expect(segments).toEqual([
    { text: "Ich" },
    { text: " " },
    { text: "wohne" },
    { text: " " },
    { text: "in" },
    { text: " " },
    { text: "Berlin", new: true },
    { text: ", " },
    { text: "Frau", new: true, translation: "женщина" },
    { text: " " },
    { text: "Klein", new: true },
    { text: "." },
  ]);
  expect(segments.map((s) => s.text).join("")).toBe("Ich wohne in Berlin, Frau Klein.");
});
