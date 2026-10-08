import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lesson } from "@sprachanker/schema";
import { z } from "zod";
import { writeFileAtomic } from "../src/files.ts";
import { HostRefusedError, type PoliteFetcher } from "../src/http.ts";
import { failedMedia, fetchMedia, goneMedia } from "../src/media-index.ts";
import { createMediaStore } from "../src/media-store.ts";
import { libraryWriter } from "../src/provider.ts";

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
  const writer = libraryWriter(root, () => {});
  await writer.write([{ path: "canonical/c1/lessons/01-01.json", schema: z.any(), value: {} }]);
  await writer.write([{ path: "canonical/c1/course.json", schema: Lesson, value: {} }]);
  expect(writer.problems).toBe(1);
  expect(await writer.finish()).toEqual(["canonical/c1/lessons/09-09.json"]);
  expect([existsSync(stale), existsSync(other)]).toEqual([false, true]);
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
  // Deleted by hand: fetched again.
  await Bun.file(join(root, "media/audio/a.mp3")).delete();
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
