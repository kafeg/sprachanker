import { expect, test } from "bun:test";
import { offersOf } from "../../src/app/experimental.ts";

test("each section offers its own kind, not installed, shown — by course", () => {
  const catalog = [
    { key: "a", installed: false, series: "dw.nicos-weg", course: "a1-ru" },
    { key: "b", installed: true, series: "dw.nicos-weg", course: "a2-ru" },
    { key: "c", installed: false, kind: "exam", series: "bamf.lid", course: "lid" },
    { key: "d", installed: false, series: "lingust.english", course: "en" },
    { key: "e", installed: false, kind: "exam", series: "goethe.zertifikat", course: "a1" },
    { key: "f", installed: false, kind: "exam", series: "goethe.zertifikat", course: "b1" },
  ];
  // A source ready only in part: its experimental course hidden, the ready one shown.
  const shown = (_section: string, series: string, course?: string) =>
    series !== "lingust.english" && !(series === "goethe.zertifikat" && course === "b1");
  expect(offersOf(catalog, "courses", shown).map((o) => o.key)).toEqual(["a"]);
  expect(offersOf(catalog, "exams", shown).map((o) => o.key)).toEqual(["c", "e"]);
  expect(offersOf(undefined, "courses", shown)).toEqual([]);
});
