import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { courseInstaller } from "../src/providers.ts";

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
  const { series } = await installer.storage();
  expect(series[0]?.series).toBe("dw.nicos-weg");
  expect(series[0]?.bytes).toBeGreaterThan(10);
  // Every provider's courses are offered, each with its series folder.
  const offers = installer.offers();
  expect(offers.map((o) => `${o.series}/${o.course}`)).toContain("coerll.dib/dib");
  expect(offers.every((o) => o.approxBytes > 0 && o.title && o.source.url)).toBe(true);
});
