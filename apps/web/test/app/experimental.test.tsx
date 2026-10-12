import { expect, test } from "bun:test";
import { offersOf, useShown } from "../../src/app/experimental.ts";
import { renderApp } from "../render.tsx";

/** What `useShown` says of each source and course, as text. */
function Shown({ asked }: { asked: Array<[string, string?]> }) {
  const { shown } = useShown();
  return (
    <p>
      {asked
        .map(([series, course]) => `${series}/${course ?? "*"}=${shown("exams", series, course)}`)
        .join(" ")}
    </p>
  );
}

const CATALOG = [
  { series: "bamf.lid", course: "lid" },
  { series: "goethe.zertifikat", course: "a1" },
  { series: "goethe.zertifikat", course: "b1", experimental: true },
  { series: "other.exam", course: "x", experimental: true },
];
const ASKED: Array<[string, string?]> = [
  ["bamf.lid"],
  ["goethe.zertifikat", "a1"],
  ["goethe.zertifikat", "b1"],
  ["goethe.zertifikat"],
  ["other.exam"],
  ["unknown.source"],
];

test("shown by course: a source ready in part shows its ready courses, its experimental ones once turned on", async () => {
  const off = await renderApp(<Shown asked={ASKED} />, { data: [[["catalog"], CATALOG]] });
  expect(off.container.textContent).toBe(
    "bamf.lid/*=true goethe.zertifikat/a1=true goethe.zertifikat/b1=false goethe.zertifikat/*=true other.exam/*=false unknown.source/*=true",
  );
  off.unmount();
  const on = await renderApp(<Shown asked={ASKED} />, {
    data: [
      [["catalog"], CATALOG],
      [["settings"], { "experimental.on": ["exams", "exams:goethe.zertifikat"] }],
    ],
  });
  expect(on.container.textContent).toContain("goethe.zertifikat/b1=true");
  expect(on.container.textContent).toContain("other.exam/*=false");
  on.unmount();
  // A catalogue that failed: nothing experimental.
  const failed = await renderApp(<Shown asked={[["other.exam"]]} />, {
    failed: [[["catalog"], new Error("offline")]],
  });
  expect(failed.container.textContent).toBe("other.exam/*=true");
  failed.unmount();
});

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
