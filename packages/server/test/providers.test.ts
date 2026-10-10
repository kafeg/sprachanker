import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CourseSlug, EditionId, SeriesKey } from "@sprachanker/schema";
import {
  courseInstaller,
  downloadEnd,
  importCourse,
  PROVIDERS,
  providerIds,
} from "../src/providers.ts";

test("download markers on disk: interrupted and incomplete downloads, space per series", async () => {
  const root = mkdtempSync(join(tmpdir(), "sprachanker-installer-"));
  const marks = join(root, "library", "dw.nicos-weg", ".downloads");
  mkdirSync(marks, { recursive: true });
  writeFileSync(join(marks, "a1-ru.json"), JSON.stringify({ startedAt: 1 }));
  writeFileSync(join(marks, "a2-ru.json"), JSON.stringify({ startedAt: 2, failed: 3 }));
  writeFileSync(join(root, "library", "dw.nicos-weg", "media.json"), "1234567890");
  const installer = courseInstaller(root);
  expect(await installer.unfinished()).toEqual([
    { series: "dw.nicos-weg", course: "a1-ru", failed: undefined },
    { series: "dw.nicos-weg", course: "a2-ru", failed: 3 },
  ]);
  // A file next to the series folders (Finder's .DS_Store) is not a series.
  writeFileSync(join(root, "library", ".DS_Store"), "x");
  const { series } = await installer.storage();
  expect(series.map((s) => s.series)).toEqual(["dw.nicos-weg"]);
  expect(series[0]?.bytes).toBeGreaterThan(10);
  // Every provider's courses are offered, each with its series folder.
  const offers = installer.offers();
  // Every provider is offered (Courses → Available), Deutsch im Blick and the English courses too.
  const offered = offers.map((o) => `${o.series}/${o.course}`);
  expect(offered).toContain("dw.nicos-weg/a1-ru");
  expect(offered).toContain("coerll.dib/dib");
  expect(offered.some((o) => o.startsWith("voa.") || o.startsWith("lingust."))).toBe(true);
  expect(providerIds()).toContain("coerll-dib");
  expect(offers.every((o) => o.approxBytes > 0 && o.title && o.source.url)).toBe(true);
});

test("one import per series at a time, also across processes", async () => {
  const root = mkdtempSync(join(tmpdir(), "sprachanker-lock-"));
  const lock = join(root, "library", "coerll.dib", ".import-lock");
  mkdirSync(lock, { recursive: true });
  // Another SprachAnker (Bun running it) holds it: its lock is respected.
  const other = Bun.spawn(["bun", "-e", "setTimeout(() => {}, 60_000)"]);
  writeFileSync(join(lock, "pid"), String(other.pid));
  await expect(importCourse("coerll-dib", { dataRoot: root, log: () => {} })).rejects.toThrow(
    /being imported by another process/,
  );
  other.kill();
});

test("every provider keeps the contract: its own id and series, courses offered with valid keys", () => {
  expect(new Set(PROVIDERS.map((p) => p.id)).size).toBe(PROVIDERS.length);
  expect(new Set(PROVIDERS.map((p) => p.series)).size).toBe(PROVIDERS.length);
  for (const p of PROVIDERS) {
    expect(SeriesKey.safeParse(p.series).success, p.id).toBe(true);
    expect(p.offers.length, p.id).toBeGreaterThan(0);
    expect(typeof p.import, p.id).toBe("function");
    const courses = p.offers.map((o) => `${o.course} ${o.edition}`);
    expect(new Set(courses).size, `${p.id}: a course offered twice`).toBe(courses.length);
    for (const o of p.offers) {
      const where = `${p.id} ${o.course}`;
      expect(CourseSlug.safeParse(o.course).success, where).toBe(true);
      expect(EditionId.safeParse(o.edition).success, where).toBe(true);
      expect(o.title && o.source.url && o.approxBytes > 0, where).toBeTruthy();
    }
  }
});

test("what is ready for learning is declared by the providers: Nicos Weg in every edition and Leben in Deutschland, alike within a series", () => {
  const offers = courseInstaller(mkdtempSync(join(tmpdir(), "sprachanker-offers-"))).offers();
  const stable = new Set(offers.filter((o) => !o.experimental).map((o) => o.series));
  expect([...stable].sort()).toEqual(["bamf.lid", "dw.nicos-weg"]);
  // The web turns a source on by its series: every offer of a series is alike.
  for (const series of new Set(offers.map((o) => o.series)))
    expect(
      new Set(offers.filter((o) => o.series === series).map((o) => !!o.experimental)).size,
    ).toBe(1);
  expect(offers.some((o) => "stable" in o)).toBe(false);
});

test("a download's end: invalid files are an error, media missing leave it incomplete, else done", () => {
  const report = (problems: number, failedMedia: string[] = []) => ({
    failedMedia,
    goneMedia: [],
    normalised: { "a1-ru ru-de": { lessons: 3, unknown: 0, problems } },
  });
  expect(downloadEnd(report(2), 0)).toEqual({
    error: "2 files failed validation (listed in the log)",
  });
  expect(downloadEnd(report(0, ["https://x.test/a.mp3: 503"]), 1)).toEqual({ failed: 2 });
  expect(downloadEnd(report(0), 0)).toEqual({ failed: 0 });
});
