import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyReport, importReport, rawPages } from "../src/importing.ts";
import { mediaRef } from "../src/media-index.ts";
import { nodeFs } from "../src/node-fs.ts";
import type { ImportProgress } from "../src/provider.ts";

const dir = () => mkdtempSync(join(tmpdir(), "sprachanker-raw-"));

test("raw pages: fetched once and kept, read from there after, counted each time", async () => {
  const root = dir();
  const progress: ImportProgress[] = [];
  let fetched = 0;
  const fetch = async () => `page ${++fetched}`;
  const pages = rawPages(root, { fs: nodeFs, progress: (p) => progress.push(p) });
  expect(await pages.text("raw/x/a.html", fetch)).toBe("page 1");
  expect(await pages.text("raw/x/a.html", fetch)).toBe("page 1");
  expect(readFileSync(join(root, "raw/x/a.html"), "utf8")).toBe("page 1");
  // Asked to fetch again.
  expect(await pages.text("raw/x/a.html", fetch, true)).toBe("page 2");
  expect(await rawPages(root, { fs: nodeFs, refresh: true }).text("raw/x/a.html", fetch)).toBe(
    "page 3",
  );
  expect(progress).toEqual([1, 2, 3].map((done) => ({ phase: "pages", done })));
});

test("raw pages: bytes kept as they are; the newest kept page's time", async () => {
  const root = dir();
  const pages = rawPages(root, { fs: nodeFs });
  expect(pages.readAt()).toBe(0);
  const bytes = new Uint8Array([0, 1, 255]);
  expect(await pages.bytes("raw/c.pdf", async () => bytes)).toEqual(bytes);
  expect(
    await rawPages(root, { fs: nodeFs }).bytes("raw/c.pdf", async () => new Uint8Array()),
  ).toEqual(bytes);
  await pages.text("raw/b.html", async () => "b");
  utimesSync(join(root, "raw/c.pdf"), 1, 1);
  utimesSync(join(root, "raw/b.html"), 2, 2);
  expect(pages.readAt()).toBe(2_000);
  // A page kept another way counts too.
  await Bun.write(join(root, "raw/d.html"), "d");
  utimesSync(join(root, "raw/d.html"), 3, 3);
  pages.kept("raw/d.html");
  expect(pages.readAt()).toBe(3_000);
});

test("the report: media not fetched from the index, the courses normalised", () => {
  expect(emptyReport()).toEqual({ failedMedia: [], goneMedia: [], normalised: {} });
  const report = importReport(
    {
      "https://a.test/1.mp3": { kind: "audio", error: "503" },
      "https://a.test/2.mp3": { kind: "audio", error: "404" },
    },
    { "c1 en-de": { lessons: 1, unknown: 0, problems: 0 } },
  );
  expect(report).toEqual({
    failedMedia: ["https://a.test/1.mp3: 503"],
    goneMedia: ["https://a.test/2.mp3: 404"],
    normalised: { "c1 en-de": { lessons: 1, unknown: 0, problems: 0 } },
  });
});

test("a media reference: named by its URL's file unless named otherwise", () => {
  expect(mediaRef("https://a.test/x/a.mp3?v=1", "audio")).toEqual({
    url: "https://a.test/x/a.mp3?v=1",
    kind: "audio",
    name: "a.mp3",
  });
  expect(mediaRef("https://a.test/a.png", "image", "own.png").name).toBe("own.png");
});
