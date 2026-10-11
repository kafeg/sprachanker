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

test("a stored value the list lacks counts as no filter: never an empty page with a blank filter", () => {
  // A pair stored where no course of it is offered (all downloaded already).
  const gone = filterCourses(items, ALL, "de-en");
  expect([gone.pair, gone.active, gone.shown.length]).toEqual([ALL, false, 3]);
  // A pair the chosen course does not have: the course stays, the pair goes.
  const mixed = filterCourses(items, "Deutschtrainer", "en-de");
  expect([mixed.title, mixed.pair, mixed.shown.map((i) => i.name)]).toEqual([
    "Deutschtrainer",
    ALL,
    ["c"],
  ]);
});

test("unset, the pair is the interface language's: every course explained in it, while there is one", () => {
  const ru = filterCourses(items, ALL, undefined, "ru");
  expect([ru.pair, ru.active, ru.shown.map((i) => i.name)]).toEqual(["from:ru", true, ["a", "c"]]);
  // A language with more than one pair is offered as a whole; one with a single pair is that pair.
  expect(
    filterCourses([...items, { name: "d", titles: ["X"], editions: ["ru-en"] }], ALL, ALL).pairs,
  ).toEqual(["from:ru", "en-de", "ru-de", "ru-en"]);
  // No course in the interface language: no filter. "All" chosen stays all.
  expect(filterCourses(items, ALL, undefined, "fr").pair).toBe(ALL);
  expect(filterCourses(items, ALL, ALL, "ru").shown).toHaveLength(3);
});
