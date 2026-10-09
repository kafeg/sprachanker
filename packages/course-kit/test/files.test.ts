import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lesson } from "@sprachanker/schema";
import { z } from "zod";
import { writeFileAtomic } from "../src/files.ts";
import { HostRefusedError, type PoliteFetcher } from "../src/http.ts";
import { failedMedia, fetchMedia, goneMedia } from "../src/media-index.ts";
import { createMediaStore } from "../src/media-store.ts";
import { libraryFile, libraryWriter, writeLibraryFiles } from "../src/provider.ts";

const dir = () => mkdtempSync(join(tmpdir(), "sprachanker-files-"));

test("a file is replaced whole: no temporary file is left next to it", async () => {
  const root = dir();
  const file = join(root, "a/b/page.html");
  await writeFileAtomic(file, "one");
  await writeFileAtomic(file, "two");
  expect(readFileSync(file, "utf8")).toBe("two");
  expect(readdirSync(join(root, "a/b"))).toEqual(["page.html"]);
});

test("a normalisation removes the files of its courses the source no longer has", async () => {
  const root = dir();
  const stale = join(root, "canonical/c1/lessons/09-09.json");
  const other = join(root, "canonical/c2/lessons/01-01.json");
  for (const f of [stale, other]) await writeFileAtomic(f, "{}");
  // A file one cut short was writing.
  const half = join(root, "canonical/c1/lessons/01-01.json.tmp-123-0a1b2c3d");
  writeFileSync(half, "{");
  const writer = libraryWriter(root, () => {});
  await writer.write([{ path: "canonical/c1/lessons/01-01.json", schema: z.any(), value: {} }]);
  await writer.write([{ path: "canonical/c1/course.json", schema: Lesson, value: {} }]);
  expect(writer.problems).toBe(1);
  expect((await writer.finish()).sort()).toEqual([
    "canonical/c1/lessons/01-01.json.tmp-123-0a1b2c3d",
    "canonical/c1/lessons/09-09.json",
  ]);
  expect([existsSync(stale), existsSync(other), existsSync(half)]).toEqual([false, true, false]);
});

/** A fetcher that writes `body` for each URL, or throws what `fail` gives. */
function fetcherOf(fail: (url: string) => Error | undefined = () => undefined) {
  const asked: string[] = [];
  const fetcher = {
    async file(url: string, target: string) {
      asked.push(url);
      const error = fail(url);
      if (error) throw error;
      writeFileSync(target, `body of ${url}`);
      return { contentType: "audio/mpeg" };
    },
  } as unknown as PoliteFetcher;
  return { fetcher, asked };
}

test("media: each URL once; a stored file gone from the disk is fetched again", async () => {
  const root = dir();
  const store = createMediaStore(root);
  const indexFile = join(root, "media.json");
  const ref = { url: "https://cdn.test/a.mp3", kind: "audio" as const, name: "a.mp3" };
  const { fetcher, asked } = fetcherOf();
  await fetchMedia({ fetcher, store, indexFile, refs: [ref, ref], log: () => {} });
  expect(asked).toEqual([ref.url]);
  await fetchMedia({ fetcher, store, indexFile, refs: [ref], log: () => {} });
  expect(asked).toHaveLength(1);
  // Deleted by hand: fetched again; a download an import cut short left goes.
  await Bun.file(join(root, "media/audio/a.mp3")).delete();
  writeFileSync(join(root, "media/.incoming/b.mp3.tmp-1-0a1b2c3d"), "half");
  await fetchMedia({ fetcher, store, indexFile, refs: [ref], log: () => {} });
  expect(asked).toHaveLength(2);
  expect(readdirSync(join(root, "media/.incoming"))).toEqual([]);
});

test("media: a host that refuses leaves every file of it recorded as not fetched", async () => {
  const root = dir();
  const refs = ["a", "b", "c"].map((n) => ({
    url: `https://cdn.test/${n}.mp3`,
    kind: "audio" as const,
    name: `${n}.mp3`,
  }));
  const { fetcher } = fetcherOf(() => new HostRefusedError("cdn.test", 429));
  const index = await fetchMedia({
    fetcher,
    store: createMediaStore(root),
    indexFile: join(root, "media.json"),
    refs,
    log: () => {},
  });
  expect(Object.values(index)).toEqual(refs.map(() => ({ kind: "audio", error: "refused 429" })));
});

test("media the source no longer has (404, 410) are gone, not failed: a course is complete without them", () => {
  const index = {
    "https://a.test/one.pdf": { kind: "pdf", error: "404" },
    "https://a.test/two.mp3": { kind: "audio", error: "410" },
    "https://a.test/three.mp3": { kind: "audio", error: "503" },
    "https://a.test/four.mp3": { kind: "audio", error: "refused 429" },
    "https://a.test/five.mp3": {
      kind: "audio",
      path: "media/audio/five.mp3",
      sha256: "x",
      size: 1,
    },
  } as never;
  expect(failedMedia(index)).toEqual([
    "https://a.test/three.mp3: 503",
    "https://a.test/four.mp3: refused 429",
  ]);
  expect(goneMedia(index)).toEqual(["https://a.test/one.pdf: 404", "https://a.test/two.mp3: 410"]);
});

test("media: the same content from several URLs under other names is one file", async () => {
  const root = dir();
  const refs = ["a", "b", "c"].map((n) => ({
    url: `https://${n}.test/${n}.mp3`,
    kind: "audio" as const,
    name: `${n}.mp3`,
  }));
  // a and b give the same bytes, c other ones; all downloaded at once.
  const fetcher = {
    async file(url: string, target: string) {
      writeFileSync(target, url.includes("c.test") ? "other" : "same");
      return { contentType: "audio/mpeg" };
    },
  } as unknown as PoliteFetcher;
  const index = await fetchMedia({
    fetcher,
    store: createMediaStore(root),
    indexFile: join(root, "media.json"),
    refs,
    log: () => {},
  });
  const paths = refs.map((r) => (index[r.url] as { path: string }).path);
  expect(paths[0]).toBe(paths[1] as string);
  expect(paths[2]).not.toBe(paths[0] as string);
  expect(readdirSync(join(root, "media/audio")).sort()).toHaveLength(2);
});

test("media: URLs stored before as two files of the same content point to one after a run; the files stay", async () => {
  const root = dir();
  const audio = join(root, "media/audio");
  mkdirSync(audio, { recursive: true });
  for (const name of ["x.mp3", "y.mp3"]) writeFileSync(join(audio, name), "same");
  const entry = (name: string) => ({
    kind: "audio",
    path: `media/audio/${name}`,
    sha256: "a".repeat(64),
    size: 4,
    mime: "audio/mpeg",
  });
  const indexFile = join(root, "media.json");
  writeFileSync(
    indexFile,
    JSON.stringify({
      "https://a.test/y.mp3": entry("y.mp3"),
      "https://a.test/x.mp3": entry("x.mp3"),
    }),
  );
  const { fetcher, asked } = fetcherOf();
  const refs = ["x", "y"].map((n) => ({
    url: `https://a.test/${n}.mp3`,
    kind: "audio" as const,
    name: `${n}.mp3`,
  }));
  const run = () =>
    fetchMedia({ fetcher, store: createMediaStore(root), indexFile, refs, log: () => {} });
  const index = await run();
  expect(asked).toEqual([]);
  expect(Object.values(index).map((e) => (e as { path: string }).path)).toEqual([
    "media/audio/x.mp3",
    "media/audio/x.mp3",
  ]);
  expect(JSON.parse(readFileSync(indexFile, "utf8"))["https://a.test/y.mp3"].path).toBe(
    "media/audio/x.mp3",
  );
  expect(readdirSync(audio).sort()).toEqual(["x.mp3", "y.mp3"]);
  // Again: the same.
  expect(await run()).toEqual(index);
});

test("a media.json that does not read stops the fetch (taken as empty, it would fetch every file again)", async () => {
  const root = dir();
  const indexFile = join(root, "media.json");
  writeFileSync(indexFile, JSON.stringify({ "https://a.test/a.mp3": { kind: "audio", pth: "x" } }));
  const { fetcher, asked } = fetcherOf();
  const ref = { url: "https://a.test/a.mp3", kind: "audio" as const, name: "a.mp3" };
  await expect(
    fetchMedia({ fetcher, store: createMediaStore(root), indexFile, refs: [ref], log: () => {} }),
  ).rejects.toThrow(/media\.json/);
  expect(asked).toEqual([]);
});

test("library files by kind: each path from its keys, each checked against its kind's schema", async () => {
  const lesson = {
    format: 1,
    key: "a.b/c1/02-03",
    unit: "a.b/c1/u02",
    media: {},
    goals: [],
    pages: [],
    vocab: [],
    unmapped: [],
  } as unknown as Parameters<typeof libraryFile.lesson>[0];
  expect(libraryFile.lesson(lesson).path).toBe("canonical/c1/lessons/02-03.json");
  const exam = { key: "a.b/c1/exam-mini" } as unknown as Parameters<typeof libraryFile.exam>[0];
  expect(libraryFile.exam(exam).path).toBe("canonical/c1/exams/mini.json");
  const root = dir();
  // A lesson whose value does not fit is written all the same, and counted.
  const bad = { ...lesson, typo: 1 } as typeof lesson;
  expect(
    await writeLibraryFiles(root, [libraryFile.lesson(lesson), libraryFile.lesson(bad)], () => {}),
  ).toBe(1);
});
