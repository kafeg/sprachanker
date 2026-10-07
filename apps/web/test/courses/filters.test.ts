import { expect, test } from "bun:test";
import { ALL, filterCourses } from "../../src/courses/filter.ts";

const items = [
  { name: "a", titles: ["Nicos Weg A1"], editions: ["ru-de"] },
  { name: "b", titles: ["Nicos Weg A1"], editions: ["en-de"] },
  { name: "c", titles: ["Deutschtrainer"], editions: ["ru-de"] },
];

test("no filter: every course; the lists offer everything there is, sorted", () => {
  const all = filterCourses(items, ALL, ALL);
  expect(all.shown.map((i) => i.name)).toEqual(["a", "b", "c"]);
  expect(all.titles).toEqual(["Deutschtrainer", "Nicos Weg A1"]);
  expect(all.pairs).toEqual(["en-de", "ru-de"]);
  expect(all.active).toBe(false);
});

test("each filter offers only what fits the other, so the two never empty the page", () => {
  const pair = filterCourses(items, ALL, "en-de");
  expect(pair.shown.map((i) => i.name)).toEqual(["b"]);
  expect(pair.titles).toEqual(["Nicos Weg A1"]);
  const title = filterCourses(items, "Deutschtrainer", ALL);
  expect(title.pairs).toEqual(["ru-de"]);
  expect(filterCourses(items, "Nicos Weg A1", "ru-de").shown.map((i) => i.name)).toEqual(["a"]);
  expect(title.active).toBe(true);
});
