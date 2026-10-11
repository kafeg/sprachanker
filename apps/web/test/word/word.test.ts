import { expect, test } from "bun:test";
import { pageTitle } from "../../src/lesson/reference.tsx";
import { articlesKept } from "../../src/word/word.tsx";

test("an article keeps its noun on its line; a word ending as one does not", () => {
  expect(articlesKept("der Altenpfleger, die Altenpfleger")).toBe(
    "der Altenpfleger, die Altenpfleger",
  );
  expect(articlesKept("Das Heim")).toBe("Das Heim");
  // "oder", "Kinder": no article.
  expect(articlesKept("Kinder oder Eltern")).toBe("Kinder oder Eltern");
});

test("a page's part stays with its number and its title", () => {
  const t = (_: string, v?: Record<string, unknown>) => `part ${v?.n}`;
  expect(pageTitle({ title: "Adjektive", part: 3 }, t)).toBe("Adjektive · part 3");
});
