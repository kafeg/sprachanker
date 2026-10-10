import { expect, test } from "bun:test";
import { offersOf } from "../../src/app/experimental.ts";

test("each section offers its own kind, not installed, shown", () => {
  const catalog = [
    { key: "a", installed: false, series: "dw.nicos-weg" },
    { key: "b", installed: true, series: "dw.nicos-weg" },
    { key: "c", installed: false, kind: "exam", series: "bamf.lid" },
    { key: "d", installed: false, series: "lingust.english" },
  ];
  const shown = (_section: string, series: string) => series !== "lingust.english";
  expect(offersOf(catalog, "courses", shown).map((o) => o.key)).toEqual(["a"]);
  expect(offersOf(catalog, "exams", shown).map((o) => o.key)).toEqual(["c"]);
  expect(offersOf(undefined, "courses", shown)).toEqual([]);
});
