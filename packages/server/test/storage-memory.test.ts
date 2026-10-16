// The storage adapters over files kept in memory (course-kit's memoryFs): what the phone app runs
// them over is its own DataFs, so they must reach files only through it — a model downloaded and
// checked, deck folders written whole, a course bundle exported and installed into another data root.
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { writeFixtureLibrary } from "@sprachanker/course-fixture";
import { openLibrary, readAll, sha256Hex } from "@sprachanker/course-kit";
import { memoryFs } from "@sprachanker/course-kit/memory-fs";
import { createCourseTransfer } from "../src/services/course-transfer.ts";
import { courseTransferFiles } from "../src/storage/course-transfer.ts";
import { deckFiles } from "../src/storage/decks.ts";
import { courseInstaller } from "../src/storage/installer.ts";
import { modelStore } from "../src/storage/model-files.ts";
import { readingCache } from "../src/storage/readings.ts";
import type { DataRoot } from "../src/storage/root.ts";

const rootOver = (fs = memoryFs(), fetchFn: typeof fetch = fetch): DataRoot => ({
  fs,
  path: "/data",
  pid: 0,
  runs: () => false,
  fetch: fetchFn,
});

test("a model downloaded in parts, checked against its sha256; a wrong one leaves nothing", async () => {
  const fs = memoryFs();
  const bytes = new Uint8Array(100_000).map((_, i) => i % 251);
  const serve = (async () =>
    new Response(
      new ReadableStream({
        start(c) {
          for (let at = 0; at < bytes.length; at += 30_000) c.enqueue(bytes.slice(at, at + 30_000));
          c.close();
        },
      }),
    )) as unknown as typeof fetch;
  const store = modelStore(fs, "/data/models", serve);
  const seen: number[] = [];
  const model = {
    id: "m",
    file: "m.bin",
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  await store.download(
    "https://models.test/m.bin",
    model,
    (n) => seen.push(n),
    new AbortController().signal,
  );
  expect(store.path("m.bin", bytes.length)).toBe("/data/models/m.bin");
  expect(seen.at(-1)).toBe(bytes.length);
  expect(fs.files()).toEqual(["/data/models/m.bin"]);
  const wrong = { ...model, file: "w.bin", sha256: "0".repeat(64) };
  await expect(
    store.download("https://models.test/w.bin", wrong, () => {}, new AbortController().signal),
  ).rejects.toThrow("checksum mismatch");
  expect(fs.files()).toEqual(["/data/models/m.bin"]);
});

test("a deck folder written whole, its media kept across an update; an upload staged and read", async () => {
  const fs = memoryFs();
  const decks = deckFiles(rootOver(fs), () => new Blob([]) as never);
  await decks.write("d1", [new Map([["media/a.mp3", new Uint8Array([1])]])], () => '{"v":1}');
  await decks.write("d1", [new Map([["media/b.mp3", new Uint8Array([2])]])], () => '{"v":2}');
  expect(decks.read("d1")).toBe('{"v":2}');
  expect(fs.list("/data/decks/d1/media").sort()).toEqual(["a.mp3", "b.mp3"]);
  expect(decks.ids()).toEqual(["d1"]);
  const upload = await decks.stage(new Blob([new Uint8Array([9, 9, 9])]).stream(), 10);
  expect(upload).toBeDefined();
  expect(await decks.staged(upload as string)).toEqual(new Uint8Array([9, 9, 9]));
  expect(await decks.stage(new Blob([new Uint8Array(20)]).stream(), 10)).toBeUndefined();
});

test("a course exported over one memory without hard links and installed over another: the same files, no media copied", async () => {
  // The phone's storage: no hard links.
  const from = memoryFs({ links: false });
  await writeFixtureLibrary(from, "/data/library");
  const series = "sprachanker.fixture";
  const course = openLibrary(from, "/data/library").courses()[0];
  if (!course) throw new Error("no fixture course");
  const transfer = (fs: ReturnType<typeof memoryFs>) =>
    createCourseTransfer({
      files: courseTransferFiles(rootOver(fs)),
      appVersion: "0.0.0",
      now: () => 0,
    });
  const out = transfer(from);
  const ready = await out.prepare(series, [course.course], course.editions);
  // Made ready: only what an import rewrites in place copied aside, no media.
  const aside = from.files().filter((f) => f.startsWith(`/data/library/.transfers/${ready.id}/`));
  expect(aside.length).toBeGreaterThan(0);
  expect(aside.some((f) => f.includes("/media/"))).toBe(false);
  const { stream, bytes } = out.download(ready.id);
  const zip = new Uint8Array(await new Response(stream).arrayBuffer());
  expect(zip.length).toBe(bytes);
  expect(from.list("/data/library/.transfers")).toEqual([]);
  // Imported on the other side, read as it comes in small chunks: every file as it was.
  const to = memoryFs({ links: false });
  const chunks = async function* () {
    for (let at = 0; at < zip.length; at += 1000) yield zip.subarray(at, at + 1000);
  };
  const result = await transfer(to).importUpload(chunks(), zip.length);
  expect(result.courses.map((c) => c.status)).toEqual(["added"]);
  for (const f of from.files().filter((p) => p.startsWith(`/data/library/${series}/`)))
    if (!f.includes("/raw/"))
      expect(sha256Hex(await readAll(to, f))).toBe(sha256Hex(await readAll(from, f)));
  expect(to.list("/data/library/.transfers")).toEqual([]);
});

test("readings kept through the files given: made once (a second request waits for the first), read again from the file", async () => {
  const fs = memoryFs();
  fs.writeFile("/data/cache/tts/old.part", "left by a stopped server");
  const cache = readingCache(fs, "/data");
  expect(fs.list("/data/cache/tts")).toEqual([]);
  let made = 0;
  const produce = async () => {
    made++;
    await Bun.sleep(5);
    return new Uint8Array([1, 2, 3]);
  };
  const [a, b] = await Promise.all([cache.kept("k", produce), cache.kept("k", produce)]);
  expect([...a]).toEqual([1, 2, 3]);
  expect([...b]).toEqual([1, 2, 3]);
  expect(made).toBe(1);
  expect(fs.list("/data/cache/tts")).toEqual(["k.wav"]);
  expect([...(await cache.kept("k", produce))]).toEqual([1, 2, 3]);
  expect(made).toBe(1);
  // Nobody waits any more: the making is stopped, and nothing is kept.
  const stop = new AbortController();
  let stopped = false;
  const held = cache.kept(
    "slow",
    (signal) =>
      new Promise((_, reject) =>
        signal.addEventListener("abort", () => {
          stopped = true;
          reject(new Error("stopped"));
        }),
      ),
    stop.signal,
  );
  stop.abort();
  await expect(held).rejects.toThrow();
  expect(stopped).toBe(true);
  expect(fs.list("/data/cache/tts")).toEqual(["k.wav"]);
});

test("an export whose media file changed after it was made ready fails its stream", async () => {
  let clock = 1;
  const fs = memoryFs({ now: () => clock++ });
  await writeFixtureLibrary(fs, "/data/library");
  const course = openLibrary(fs, "/data/library").courses()[0];
  if (!course) throw new Error("no fixture course");
  const files = courseTransferFiles(rootOver(fs));
  const staged = await files.stage(course.series, [course.course], course.editions);
  const media = staged.files.find((f) => f.path.startsWith("media/"));
  if (!media) throw new Error("no media");
  fs.touch(`/data/library/${course.series}/${media.path}`);
  const stream = files.stream(staged.id, "{}", [media.path]);
  await expect(new Response(stream).arrayBuffer()).rejects.toThrow(/changed after it was summed/);
});

test("the installer's storage and unfinished downloads read through the files given", async () => {
  const fs = memoryFs({ free: 123 });
  fs.writeFile("/data/library/dw.nicos-weg/.downloads/a1-ru.json", '{"startedAt":1,"failed":2}');
  fs.writeFile("/data/library/dw.nicos-weg/x.bin", new Uint8Array(10));
  const installer = courseInstaller(rootOver(fs));
  expect(await installer.unfinished()).toEqual([
    { series: "dw.nicos-weg", course: "a1-ru", failed: 2 },
  ]);
  const storage = await installer.storage();
  expect(storage.free).toBe(123);
  expect(storage.series).toEqual([{ series: "dw.nicos-weg", bytes: 10 + 26 }]);
});
