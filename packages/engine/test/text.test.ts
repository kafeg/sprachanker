import { describe, expect, test } from "bun:test";
import { headword, normalise, sameText, wordDiff } from "../src/index.ts";

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
