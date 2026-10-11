import { expect, test } from "bun:test";
import type { Lesson } from "@sprachanker/schema";
import { wordCount } from "../../src/lesson/plan.tsx";

test("a lesson's words count as its Words step makes cards: two entries of one word are one", () => {
  const lesson = {
    vocab: [
      { lexeme: "lex:de:sich-trauen:verb", target: "sich trauen" },
      { lexeme: "lex:de:sich-trauen:verb", target: "sich (etwas) trauen" },
      { lexeme: "lex:de:taufe:noun", target: "die Taufe" },
    ],
  } as unknown as Lesson;
  expect(wordCount(lesson)).toBe(2);
});
