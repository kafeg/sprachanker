// The storage adapters over files kept in memory (course-kit's memoryFs): what the phone app runs
// them over is its own DataFs, so they must reach files only through it — a model downloaded and
// checked, deck folders written whole, a course bundle exported and installed into another data root.
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { writeFixtureLibrary } from "@sprachanker/course-fixture";
import { chunksOf, openLibrary, readAll, sha256Hex } from "@sprachanker/course-kit";
import { memoryFs } from "@sprachanker/course-kit/memory-fs";
import { courseTransferFiles } from "../src/storage/course-transfer.ts";
import { deckFiles } from "../src/storage/decks.ts";
import { courseInstaller } from "../src/storage/installer.ts";
import { modelStore } from "../src/storage/model-files.ts";
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

test("a course exported over one memory and installed over another: the same files", async () => {
  const from = memoryFs();
  await writeFixtureLibrary(from, "/data/library");
  const series = "sprachanker.fixture";
  const course = openLibrary(from, "/data/library").courses()[0];
  if (!course) throw new Error("no fixture course");
  const out = courseTransferFiles(rootOver(from));
  const staged = await out.stage(series, [course.course], course.editions);
  const manifest = JSON.stringify({ files: staged.files });
  const paths = staged.files.map((f) => f.path);
  const length = out.bytes(staged.id, manifest, paths);
  const zip = new Uint8Array(
    await new Response(out.stream(staged.id, manifest, paths)).arrayBuffer(),
  );
  expect(zip.length).toBe(length);
  // Read back on the other side: its directory, every file as it was.
  const to = memoryFs();
  const into = courseTransferFiles(rootOver(to));
  const id = into.begin();
  expect(await into.receive(id, chunksOf(zip), zip.length)).toBe(true);
  const read = into.read(id);
  expect(read?.manifest).toBe(manifest);
  expect(read?.entries.map((e) => e.path).sort()).toEqual([...paths].sort());
  for (const f of staged.files)
    expect(sha256Hex(await readAll(from, `/data/library/${series}/${f.path}`))).toBe(f.sha256);
  into.discard(id);
  expect(to.list("/data/library/.transfers")).toEqual([]);
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
