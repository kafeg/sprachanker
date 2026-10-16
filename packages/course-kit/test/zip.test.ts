import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeFs } from "../src/node-fs.ts";
import {
  bytesEntry,
  entryBytes,
  fileEntry,
  fileSums,
  type ZipSource,
  zipEntries,
  zipLength,
  zipLimits,
  zipRead,
  zipStream,
} from "../src/zip.ts";

const LIMITS = { countMax: 1000, fieldMax: 256, directoryMax: 1024 * 1024 };
const dir = () => mkdtempSync(join(tmpdir(), "sprachanker-zip-"));
const text = (s: string) => new TextEncoder().encode(s);

async function written(entries: ZipSource[], options: { force64?: boolean } = {}) {
  const parts: Uint8Array[] = [];
  for await (const chunk of zipStream(entries, options)) parts.push(chunk);
  const bytes = new Uint8Array(Buffer.concat(parts));
  const file = join(dir(), "out.zip");
  writeFileSync(file, bytes);
  return { file, bytes };
}

/** A zip's bytes changed in place (or replaced), then read. */
function changed(bytes: Uint8Array, change: (b: Buffer) => Uint8Array | undefined) {
  const file = join(dir(), "changed.zip");
  const b = Buffer.from(bytes);
  writeFileSync(file, change(b) ?? b);
  return zipEntries(nodeFs, file, LIMITS);
}

/** A change writing a 32-bit value at an offset. */
const at = (offset: number, value: number) => (b: Buffer) => {
  b.writeUInt32LE(value, offset);
  return undefined;
};

test("a zip written and read back: every entry where the directory says, its length known before", async () => {
  const root = dir();
  const media = join(root, "clip.mp3");
  writeFileSync(
    media,
    new Uint8Array(70_000).map((_, i) => (i * 31) % 256),
  );
  const sums = await fileSums(nodeFs, media);
  const entries = [
    bytesEntry("manifest.json", text('{"a":1}')),
    fileEntry(nodeFs, "media/audio/clip.mp3", media, sums),
    bytesEntry("media/image/ünïcode.png", text("png")),
    bytesEntry("empty.txt", new Uint8Array(0)),
  ];
  for (const force64 of [false, true]) {
    const { file, bytes } = await written(entries, { force64 });
    expect(bytes.length).toBe(zipLength(entries, { force64 }));
    const read = zipEntries(nodeFs, file, LIMITS);
    expect(read?.map((e) => [e.name, e.size])).toEqual([
      ["manifest.json", 7],
      ["media/audio/clip.mp3", 70_000],
      ["media/image/ünïcode.png", 3],
      ["empty.txt", 0],
    ]);
    const clip = read?.[1];
    expect(clip && Buffer.from(entryBytes(nodeFs, file, clip)).equals(readFileSync(media))).toBe(
      true,
    );
  }
});

test("an entry whose file changed size meanwhile fails the zip", async () => {
  const root = dir();
  const media = join(root, "clip.mp3");
  writeFileSync(media, "short");
  const sums = await fileSums(nodeFs, media);
  writeFileSync(media, "longer now");
  await expect(written([fileEntry(nodeFs, "clip.mp3", media, sums)])).rejects.toThrow(/changed/);
});

test("more entries than a zip may hold, or a directory larger than they need, refused before it is read", async () => {
  const entries = ["a", "b", "c"].map((n) => bytesEntry(`${n}.txt`, text(n)));
  const { file } = await written(entries);
  expect(zipEntries(nodeFs, file, { ...LIMITS, countMax: 3 })).toHaveLength(3);
  expect(zipEntries(nodeFs, file, { ...LIMITS, countMax: 2 })).toBeUndefined();
  expect(zipEntries(nodeFs, file, zipLimits(3, 256, 5))).toHaveLength(3);
  expect(zipEntries(nodeFs, file, { ...LIMITS, directoryMax: 3 * 46 })).toBeUndefined();
});

test("a zip is believed only as far as it is checked", async () => {
  const entries = [bytesEntry("a.txt", text("aaaa")), bytesEntry("b.txt", text("bbbb"))];
  const { bytes } = await written(entries);
  const centralAt = bytes.length - 22 - 2 * (46 + 5);
  // Not a zip; bytes after the end record.
  expect(changed(bytes, () => text("hello"))).toBeUndefined();
  expect(changed(bytes, (b) => Buffer.concat([b, Buffer.from([0])]))).toBeUndefined();
  // Compressed (the method, with the time after it); encrypted (the flags, the local header's too).
  expect(changed(bytes, at(centralAt + 10, 8))).toBeUndefined();
  expect(
    changed(bytes, (b) => {
      b.writeUInt16LE(0x0801, centralAt + 8);
      b.writeUInt16LE(0x0801, 6);
      return undefined;
    }),
  ).toBeUndefined();
  // A size in the directory that the local header does not have.
  expect(changed(bytes, at(centralAt + 20, 3))).toBeUndefined();
  // The second entry pointing at the first one's header (overlapping).
  expect(changed(bytes, at(centralAt + 46 + 5 + 42, 0))).toBeUndefined();
  // A ZIP64 marker with no ZIP64 field behind it.
  expect(changed(bytes, at(centralAt + 42, 0xffffffff))).toBeUndefined();
  // Unchanged, it reads.
  expect(changed(bytes, () => undefined)?.map((e) => e.name)).toEqual(["a.txt", "b.txt"]);
});

test("ZIP64 end records are checked: the locator right before the end record, the record right before it", async () => {
  const { bytes } = await written([bytesEntry("a.txt", text("aaaa"))], { force64: true });
  const locatorAt = bytes.length - 22 - 20;
  const recordAt = locatorAt - 56;
  expect(changed(bytes, () => undefined)?.map((e) => e.name)).toEqual(["a.txt"]);
  expect(changed(bytes, at(locatorAt, 0))).toBeUndefined();
  // The record said to be elsewhere.
  expect(changed(bytes, at(locatorAt + 8, 0))).toBeUndefined();
  // More entries than the directory holds.
  expect(
    changed(bytes, (b) => {
      b.writeBigUInt64LE(2n, recordAt + 24);
      b.writeBigUInt64LE(2n, recordAt + 32);
      return undefined;
    }),
  ).toBeUndefined();
});

/** A zip read as it comes, in chunks of `size` bytes: each entry's name and bytes (`skip`: those
 *  whose bytes are not read), or the error's code. */
async function readAsItComes(
  bytes: Uint8Array,
  size = 7,
  skip = new Set<string>(),
  limits = LIMITS,
) {
  async function* chunks() {
    for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size);
  }
  const out: Array<[string, string]> = [];
  try {
    for await (const e of zipRead(chunks(), limits)) {
      if (skip.has(e.name)) {
        out.push([e.name, "-"]);
        continue;
      }
      const parts: Uint8Array[] = [];
      for await (const part of e.data) parts.push(part);
      out.push([e.name, Buffer.concat(parts).toString()]);
    }
    return out;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

test("a zip read as it comes: each entry by the size its header gives, the directory checked against them at the end", async () => {
  const entries = [
    bytesEntry("manifest.json", text('{"a":1}')),
    // Bytes that look like headers inside an entry are only its bytes.
    bytesEntry("trap.bin", text("PK\x03\x04PK\x01\x02PK\x05\x06")),
    bytesEntry("ünïcode.txt", text("ü")),
    bytesEntry("empty.txt", new Uint8Array(0)),
  ];
  for (const force64 of [false, true]) {
    const { bytes } = await written(entries, { force64 });
    for (const size of [1, 7, bytes.length])
      expect(await readAsItComes(bytes, size)).toEqual([
        ["manifest.json", '{"a":1}'],
        ["trap.bin", "PK\x03\x04PK\x01\x02PK\x05\x06"],
        ["ünïcode.txt", "ü"],
        ["empty.txt", ""],
      ]);
    // An entry not read passes by.
    expect(await readAsItComes(bytes, 3, new Set(["trap.bin"]))).toEqual([
      ["manifest.json", '{"a":1}'],
      ["trap.bin", "-"],
      ["ünïcode.txt", "ü"],
      ["empty.txt", ""],
    ]);
  }
});

test("a zip read as it comes is believed only as far as it is checked", async () => {
  const entries = [bytesEntry("a.txt", text("aaaa")), bytesEntry("b.txt", text("bbbb"))];
  const { bytes } = await written(entries);
  const centralAt = bytes.length - 22 - 2 * (46 + 5);
  const bad = async (change: (b: Buffer) => Uint8Array | undefined) => {
    const b = Buffer.from(bytes);
    return readAsItComes(new Uint8Array(change(b) ?? b));
  };
  expect(await bad(() => undefined)).toEqual([
    ["a.txt", "aaaa"],
    ["b.txt", "bbbb"],
  ]);
  // Not a zip; cut short; bytes after the end record.
  expect(await bad(() => text("hello"))).toBe("EBADZIP");
  expect(await bad((b) => b.subarray(0, b.length - 1))).toBe("EBADZIP");
  expect(await bad((b) => Buffer.concat([b, Buffer.from([0])]))).toBe("EBADZIP");
  // Compressed; a data descriptor (no size in the header): never read as it comes.
  expect(await bad(at(8, 8))).toBe("EBADZIP");
  expect(await bad(at(6, 8))).toBe("EBADZIP");
  // The directory not its entries: another size, another offset (overlapping), another CRC, one
  // entry fewer than were read.
  expect(await bad(at(centralAt + 20, 3))).toBe("EBADZIP");
  expect(await bad(at(centralAt + 46 + 5 + 42, 0))).toBe("EBADZIP");
  expect(await bad(at(centralAt + 16, 1))).toBe("EBADZIP");
  expect(
    await bad((b) => {
      b.writeUInt16LE(1, b.length - 22 + 8);
      b.writeUInt16LE(1, b.length - 22 + 10);
      return undefined;
    }),
  ).toBe("EBADZIP");
  // More entries than a zip may hold; a directory larger than they need.
  const { bytes: three } = await written(
    ["a", "b", "c"].map((n) => bytesEntry(`${n}.txt`, text(n))),
  );
  expect(await readAsItComes(three, 7, new Set(), { ...LIMITS, countMax: 3 })).toHaveLength(3);
  expect(await readAsItComes(three, 7, new Set(), { ...LIMITS, countMax: 2 })).toBe("EBADZIP");
  expect(await readAsItComes(three, 7, new Set(), { ...LIMITS, directoryMax: 2 * 46 })).toBe(
    "EBADZIP",
  );
});
