// Synthetic pages shaped like DW's; no real content.
import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPoliteFetcher } from "@sprachanker/course-kit";
import type { DwCourse } from "../src/catalog.ts";
import { fetchPages } from "../src/pages.ts";

const course: DwCourse = {
  series: "nicos-weg",
  id: "a1-ru",
  course: "a1",
  edition: "ru-de",
  lang: "ru",
  sourceId: 1,
  approxBytes: 1,
};
const html = (state: object) =>
  `<script>window.__APOLLO_STATE__ = ${JSON.stringify(state)};</script>`;
const PAGES: Record<string, object> = {
  "/ru/x/c-1": {
    "Course:1": {
      'contentLinks({"targetTypes":"LESSON"})': [
        { __ref: "ContentLink:10" },
        { __ref: "ContentLink:20" },
      ],
    },
    "ContentLink:10": { id: 10 },
    "ContentLink:20": { id: 20 },
  },
  "/ru/x/l-10": {
    "Lesson:10": {
      overviewParts: [
        { lessonPart: "EXERCISE", targetId: 11 },
        { lessonPart: "EXERCISE", targetId: 12 },
      ],
    },
  },
  "/ru/x/l-20": { "Lesson:20": { overviewParts: [{ lessonPart: "EXERCISE", targetId: 21 }] } },
};

test("fetches every page once, in parallel, and nothing on the next run", async () => {
  const requested: string[] = [];
  const fake = (async (input: URL | string) => {
    const url = new URL(String(input));
    requested.push(url.pathname);
    if (url.pathname === "/robots.txt")
      return new Response("User-agent: *\nDisallow: /*/*/l-*/ler$");
    const exercise = /\/e-(\d+)$/.exec(url.pathname)?.[1];
    return new Response(html(PAGES[url.pathname] ?? { [`Exercise:${exercise}`]: {} }));
  }) as typeof fetch;
  const fetcher = () =>
    createPoliteFetcher({ userAgent: "test", robotsHosts: ["learngerman.dw.com"], fetch: fake });
  const seriesDir = mkdtempSync(join(tmpdir(), "sprachanker-dw-"));

  await fetchPages(fetcher(), seriesDir, course, () => {});
  const files = readdirSync(join(seriesDir, "raw/ru-de/a1")).sort();
  expect(files).toEqual([
    "course.json",
    "e-11.json",
    "e-12.json",
    "e-21.json",
    "l-10.json",
    "l-20.json",
    "le-10.json",
    "le-20.json",
  ]);
  expect(requested.filter((p) => p !== "/robots.txt")).toHaveLength(8);

  requested.length = 0;
  await fetchPages(fetcher(), seriesDir, course, () => {});
  expect(requested).toEqual([]);
});

test("a page that came without its exercise is fetched once more", async () => {
  const requested: string[] = [];
  const fake = (async (input: URL | string) => {
    const url = new URL(String(input));
    requested.push(url.pathname);
    if (url.pathname === "/robots.txt") return new Response("User-agent: *");
    const exercise = /\/e-(\d+)$/.exec(url.pathname)?.[1];
    // e-12 comes empty the first time, as DW sometimes answers.
    const empty = exercise === "12" && requested.filter((p) => p.endsWith("/e-12")).length === 1;
    return new Response(
      html(PAGES[url.pathname] ?? (empty ? {} : { [`Exercise:${exercise}`]: {} })),
    );
  }) as typeof fetch;
  const seriesDir = mkdtempSync(join(tmpdir(), "sprachanker-dw-"));
  await fetchPages(
    createPoliteFetcher({ userAgent: "test", robotsHosts: ["learngerman.dw.com"], fetch: fake }),
    seriesDir,
    course,
    () => {},
  );
  expect(requested.filter((p) => p.endsWith("/e-12"))).toHaveLength(2);
  expect(requested.filter((p) => p.endsWith("/e-11"))).toHaveLength(1);
});
