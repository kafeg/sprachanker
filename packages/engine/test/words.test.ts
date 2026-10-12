import { expect, test } from "bun:test";
import {
  hasForm,
  markWords,
  newGlosses,
  sameWord,
  unaskedGlosses,
  usesWord,
  wordForms,
} from "../src/text/words.ts";

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
  const sein = { target: "sein" };
  const einladen = { target: "einladen" };
  expect(usesWord("Er ist zu Hause.", sein)).toBe(false);
  expect(hasForm("Er ist zu Hause.", "ist", sein)).toBe(true);
  expect(hasForm("Er lädt mich heute ein.", "lädt ein", einladen)).toBe(true);
  expect(hasForm("Er lädt mich heute.", "lädt ein", einladen)).toBe(false);
  expect(hasForm("Er kann schwimmen.", "kannst", { target: "können" })).toBe(false);
  expect(hasForm("Er kann schwimmen.", "", { target: "können" })).toBe(false);
});

test("a model's form counts only when it is of the word: a stem it shares, an irregular verb's, a separable verb's", () => {
  const cases: Array<[string, string, string]> = [
    ["Ich bin müde.", "bin", "sein"],
    ["Er ist zu Hause.", "Ist", "sein"],
    ["Ich kann gut kochen.", "kann", "können"],
    ["Sie mag Tee.", "mag", "mögen"],
    ["Ich möchte Tee.", "möchte", "mögen"],
    ["Es wird kalt.", "wird", "werden"],
    ["Sie hat Zeit.", "hat", "haben"],
    ["Er lädt uns ein.", "lädt ein", "einladen"],
    ["Er sieht oft fern.", "sieht fern", "fernsehen"],
    ["Er hat Tee getrunken.", "getrunken", "trinken"],
    ["Wir sind nach Berlin gefahren.", "gefahren", "fahren"],
    ["Die Äpfel sind rot.", "Äpfel", "der Apfel"],
    ["Er spricht Deutsch.", "spricht", "sprechen"],
  ];
  for (const [sentence, form, target] of cases)
    expect([sentence, hasForm(sentence, form, { target })]).toEqual([sentence, true]);
  // Not of the word: no stem in common, nothing irregular of it.
  expect(hasForm("Ich trinke Kaffee.", "trinke", { target: "die Tasse" })).toBe(false);
  expect(hasForm("Er ist zu Hause.", "ist", { target: "haben" })).toBe(false);
  expect(hasForm("Er trinkt Tee ein.", "trinkt ein", { target: "einladen" })).toBe(false);
  expect(hasForm("Er kommt heute.", "kommt", { target: "ankommen" })).toBe(false);
});

test("a model's form that is surely another word's — of the batch or known — is not the word's", () => {
  const fahrrad = { target: "das Fahrrad" };
  const sentence = "Ich fahre in die Stadt.";
  expect(hasForm(sentence, "fahre", fahrrad)).toBe(true);
  expect(hasForm(sentence, "fahre", fahrrad, [{ target: "fahren" }])).toBe(false);
  // An irregular form of another verb.
  expect(hasForm("Ich bin müde.", "bin", { target: "binden" })).toBe(true);
  expect(hasForm("Ich bin müde.", "bin", { target: "binden" }, [{ target: "sein" }])).toBe(false);
  // A separable verb keeps its form though the verb without the prefix is known.
  expect(
    hasForm("Er kommt um acht an.", "kommt an", { target: "ankommen" }, [{ target: "kommen" }]),
  ).toBe(true);
  // Another entry of the word itself is not another word.
  expect(
    hasForm("Die Äpfel sind rot.", "Äpfel", { target: "der Apfel" }, [
      { target: "der Apfel, die Äpfel" },
    ]),
  ).toBe(true);
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

test("a new word's translation: as written before a form of it; never by an article or an auxiliary", () => {
  const glossary = [
    { target: "die Haut", translation: "кожа" },
    { target: "das Haus, die Häuser", translation: "дом" },
    { target: "das Wort", translation: "слово" },
    { target: "studieren", forms: "studiert, studierte, hat studiert", translation: "учиться" },
  ];
  const marked = (sentence: string) =>
    markWords(sentence, [{ target: "ich" }], glossary).filter((s) => s.new);
  expect(marked("Das Haus hat Häuser.")).toEqual([
    { text: "Das", new: true },
    { text: "Haus", new: true, translation: "дом" },
    { text: "hat", new: true },
    { text: "Häuser", new: true, translation: "дом" },
  ]);
  // A short stem gives no translation: "Haut" is not "Haus", "Wand" not "wann".
  expect(
    markWords(
      "Wann ist das Haus da?",
      [],
      [
        { target: "die Haut", translation: "кожа" },
        { target: "die Wand", translation: "стена" },
      ],
    ).filter((s) => s.translation),
  ).toEqual([]);
  expect(marked("Ich studierte.")).toEqual([
    { text: "studierte", new: true, translation: "учиться" },
  ]);
});

test("a glossary of new words keeps none the learner has met: a lesson's own word is no new word", () => {
  const glossary = [
    { word: "aber", translation: "но" },
    { word: "Bahnhof", translation: "вокзал" },
    { word: "heißt", translation: "зовут" },
    { word: "zum Beispiel", translation: "например" },
  ];
  const known = [{ target: "aber" }, { target: "heißen" }, { target: "zum" }];
  expect(newGlosses(glossary, known).map((g) => g.word)).toEqual(["Bahnhof", "zum Beispiel"]);
});

test("a glossary keeps no word a question asks the meaning of — quoted in it, or its translation an option — and keeps a word a question uses", () => {
  const asked = [
    // A word a question merely uses stays glossed: it gives nothing away.
    { question: "Anna möchte drei Brötchen.", options: ["Richtig", "Falsch"] },
    // The walkthrough's meaning questions: the word quoted, whatever the options say.
    { question: 'Was bedeutet "nervt" im Text?', options: ["macht froh", "macht wütend"] },
    { question: "Was bedeutet „der Quatsch“?", options: ["ernste Arbeit", "Unsinn"] },
    { question: "Что значит «Geduld»?", options: ["Zeit zum Essen", "Ruhe und Ausdauer"] },
    { question: "Was heißt hier ‚pünktlich‘?", options: ["zu spät", "zur richtigen Zeit"] },
    // The translation among the options: the gloss is the key.
    { question: "Wie spät ist es?", options: ["в восемь часов", "в девять"] },
    { question: "Was hat Anna?", accepted: ["Uhr"] },
  ];
  const glossary = [
    { word: "das Brötchen", translation: "булочка" },
    { word: "nervt", translation: "раздражает" },
    { word: "Quatsch", translation: "чепуха" },
    { word: "die Geduld", translation: "терпение" },
    { word: "acht Uhr", translation: "восемь часов" },
    { word: "die Uhr", translation: "Uhr" },
    { word: "pünktlich", translation: "вовремя" },
    { word: "die Ruhe", translation: "покой" },
  ];
  expect(unaskedGlosses(glossary, asked).map((g) => g.word)).toEqual(["das Brötchen", "die Ruhe"]);
  expect(unaskedGlosses(glossary, [])).toEqual(glossary);
});
