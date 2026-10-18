import { describe, expect, test } from "bun:test";
import { headword, normalise, sameText, wordAsHeard, wordDiff } from "../src/index.ts";
import { NUMBER_WORDS } from "../src/text/numbers.ts";

describe("normalise", () => {
  test.each([
    ["  Wie geht’s?  ", "Wie geht's"],
    ["„Hallo“ – sagt er.", '"Hallo" - sagt er'],
    ["Gute Nacht!!", "Gute Nacht"],
    ["Café", "Café"],
  ])("%s", (input, out) => expect(normalise(input)).toBe(out));
});

describe("German case rule", () => {
  test.each([
    ["Wie geht es Ihnen?", "wie geht es Ihnen", true],
    ["Wie geht es Ihnen?", "Wie geht es ihnen?", false],
    ["Ich trinke Tee.", "ich trinke tee", false],
    ["Ich trinke Tee.", "ich trinke Tee", true],
    ["Guten Tag. Kaffee, bitte.", "guten Tag. kaffee, bitte", true],
    ["Guten Tag. Kaffee, bitte.", "guten tag. kaffee, bitte", false],
    ["Kaffee", "kaffee", true],
  ])("%s vs %s → %p", (ref, got, ok) => expect(sameText("de", ref, got)).toBe(ok));

  test("a text in mid-sentence (a gap) keeps the rule for its first word", () => {
    expect(sameText("de", "Kaffee", "kaffee", false)).toBe(false);
    expect(sameText("de", "trinke", "Trinke", false)).toBe(true);
  });

  test("other languages ignore case", () => {
    expect(sameText("ru", "Привет, Иван", "привет, иван")).toBe(true);
  });
});

describe("word diff", () => {
  test("marks missing, extra and wrong words", () => {
    const { diff, score } = wordDiff("de", "Ich trinke gern Tee", "Ich trinke Kaffee");
    expect(diff).toEqual([
      { op: "equal", expected: "Ich", actual: "Ich" },
      { op: "equal", expected: "trinke", actual: "trinke" },
      { op: "wrong", expected: "gern", actual: "Kaffee" },
      { op: "missing", expected: "Tee" },
    ]);
    expect(score).toBe(0.5);
  });

  test("marks that are not words are no words to say or write", () => {
    const { diff, score } = wordDiff(
      "en",
      "See you later. ≈ See you → soon",
      "see you later see you soon",
      true,
    );
    expect(diff.every((d) => d.op === "equal")).toBe(true);
    expect(score).toBe(1);
  });

  test("spoken: words joined differently are one word said, either way round", () => {
    for (const [ref, heard] of [
      ["Good bye.", "Goodbye"],
      ["Goodbye!", "good bye"],
      ["Good-bye.", "goodbye"],
      ["Good, bye", "goodbye"],
    ] as const) {
      const { diff, score } = wordDiff("en", ref, heard, true);
      expect(diff).toHaveLength(1);
      expect(diff[0]?.op).toBe("equal");
      expect(score).toBe(1);
    }
    const { diff, score } = wordDiff("en", "Good bye, my friend", "goodbye friend", true);
    expect(diff.map((d) => d.op)).toEqual(["equal", "missing", "equal"]);
    expect(score).toBe(2 / 3);
  });

  test("spoken German: ß and ss, 's and es, numbers in digits are one word said", () => {
    for (const [ref, heard] of [
      ["Ich heiße Nico.", "ich heisse Nico"],
      ["Wie geht es dir?", "Wie geht's dir?"],
      ["Das kostet zwei Euro fünfzig.", "Das kostet 2 Euro 50."],
      ["Er ist einundzwanzig.", "Er ist 21"],
      ["Einhundertzwei Seiten", "102 Seiten"],
      ["Zimmer eins", "Zimmer 1"],
      ["Im Jahr tausendneunhundertneunzig", "Im Jahr 1990"],
      ["Dreißig Tage", "30 Tage"],
    ] as const) {
      const { score } = wordDiff("de", ref, heard, true);
      expect([ref, score]).toEqual([ref, 1]);
    }
  });

  test("spoken English: numbers in digits are their words, short forms are said in full", () => {
    for (const [ref, heard] of [
      ["She is twenty-one.", "She is 21"],
      ["Room one hundred", "Room 100"],
      ["It is three o'clock.", "It's 3 o'clock"],
      ["I do not know.", "I don't know"],
      ["I cannot swim.", "I can't swim"],
      ["We are late, I am sorry.", "We're late, I'm sorry"],
      ["I will go. They have gone.", "I'll go. They've gone."],
      ["I would like tea.", "I'd like tea"],
      ["Let us go!", "Let's go"],
      ["It won't rain.", "It will not rain"],
    ] as const) {
      const { score } = wordDiff("en", ref, heard, true);
      expect([ref, score]).toEqual([ref, 1]);
    }
  });

  test("numbers said in each language with its words (0–9999), the same in every code path", () => {
    const said = (lang: string, n: number) => NUMBER_WORDS[lang]?.(n);
    for (const [lang, n, words] of [
      ["de", 0, "null"],
      ["de", 1, "eins"],
      ["de", 21, "einundzwanzig"],
      ["de", 101, "hunderteins"],
      ["de", 1990, "tausendneunhundertneunzig"],
      ["en", 0, "zero"],
      ["en", 13, "thirteen"],
      ["en", 21, "twentyone"],
      ["en", 100, "onehundred"],
      ["en", 105, "onehundredfive"],
      ["en", 2024, "twothousandtwentyfour"],
      ["es", 16, "dieciséis"],
      ["es", 22, "veintidós"],
      ["es", 31, "treintayuno"],
      ["es", 100, "cien"],
      ["es", 101, "cientouno"],
      ["es", 500, "quinientos"],
      ["es", 1000, "mil"],
      ["es", 2100, "dosmilcien"],
      ["fr", 17, "dixsept"],
      ["fr", 21, "vingtetun"],
      ["fr", 71, "soixanteetonze"],
      ["fr", 80, "quatrevingts"],
      ["fr", 81, "quatrevingtun"],
      ["fr", 99, "quatrevingtdixneuf"],
      ["fr", 200, "deuxcents"],
      ["fr", 201, "deuxcentun"],
      ["fr", 2000, "deuxmille"],
      ["it", 21, "ventuno"],
      ["it", 23, "ventitré"],
      ["it", 28, "ventotto"],
      ["it", 108, "centotto"],
      ["it", 1000, "mille"],
      ["it", 2003, "duemilatré"],
      ["it", 1990, "millenovecentonovanta"],
    ] as const)
      expect([lang, n, said(lang, n)]).toEqual([lang, n, words]);
    // As heard: a number of a language without words is left in digits; the language's region aside.
    expect(wordAsHeard("ru", "21")).toBe("21");
    expect(wordAsHeard("de-AT", "21")).toBe("einundzwanzig");
    expect(wordAsHeard("fr", "Vingt-et-un")).toBe(wordAsHeard("fr", "21"));
    // A short form is a language's: "'s" is "es" in German, "is" in English, nothing elsewhere.
    expect(wordAsHeard("de", "geht's")).toBe("gehtes");
    expect(wordAsHeard("en", "it's")).toBe("itis");
    expect(wordAsHeard("es", "it's")).toBe("it's");
  });

  test("words as written: the final mark kept to show, not graded", () => {
    const { diff, score } = wordDiff("de", "Ich lerne Deutsch.", "ich lerne Deutsch");
    expect(diff.at(-1)).toEqual({ op: "equal", expected: "Deutsch.", actual: "Deutsch" });
    expect(score).toBe(1);
  });

  test("typed: how words are joined counts", () => {
    const { diff } = wordDiff("en", "Good bye", "Goodbye");
    expect(diff.some((d) => d.op !== "equal")).toBe(true);
  });
});

test("headword: articles and forms off, per language", () => {
  expect(headword("de", "die Frau, die Frauen")).toBe("frau");
  expect(headword("de", "(sich) freuen")).toBe("freuen");
  expect(headword("en", "to go")).toBe("go");
  expect(headword("en", "the Die Hard")).toBe("die hard");
  expect(headword("ru", "Дом")).toBe("дом");
});
