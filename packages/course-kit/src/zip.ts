// Zips of stored entries — the files that move a course or a profile between one's machines (02, 05):
// written with every size and checksum known before an entry starts (ZIP64 where a size or an offset
// needs it), and read by their directory only as far as it is checked. Untrusted files are read here,
// so nothing a zip says is believed beyond what is checked against the rest of it.
import { createHash } from "node:crypto";
import { closeSync, createReadStream, fstatSync, openSync, readSync } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import { crc32 } from "node:zlib";

const LOCAL_HEADER = 30;
const CENTRAL_HEADER = 46;
const END_RECORD = 22;
const ZIP64_END = 56;
const ZIP64_LOCATOR = 20;
const SIG = {
  local: 0x04034b50,
  central: 0x02014b50,
  end: 0x06054b50,
  zip64End: 0x06064b50,
  zip64Locator: 0x07064b50,
  descriptor: 0x08074b50,
};
const ZIP64_EXTRA = 0x0001;
/** The most a 32-bit field holds; the value itself says "in the ZIP64 field". */
const MAX32 = 0xffffffff;
const MAX16 = 0xffff;
/** Names are UTF-8 (general purpose flag bit 11). */
const UTF8 = 0x0800;
/** 1980-01-01 00:00, the earliest DOS date: entries carry no time of their own. */
const DOS_DATE = 0x0021;

/** A file's sha256, size and CRC-32 (the zip's own check), read as a stream. */
export async function fileSums(file: string) {
  const hash = createHash("sha256");
  let size = 0;
  let crc = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk as Buffer);
    crc = crc32(chunk as Buffer, crc);
    size += (chunk as Buffer).length;
  }
  return { sha256: hash.digest("hex"), size, crc32: crc };
}

/** An entry to write: its name, size and CRC-32 known before it starts, then its bytes. */
export interface ZipSource {
  name: string;
  size: number;
  crc32: number;
  data(): AsyncIterable<Uint8Array>;
}

/** Bytes in memory as an entry. */
export function bytesEntry(name: string, bytes: Uint8Array): ZipSource {
  return {
    name,
    size: bytes.length,
    crc32: crc32(bytes),
    async *data() {
      yield bytes;
    },
  };
}

/** A file on disk as an entry, its size and CRC-32 as summed before (`fileSums`). */
export function fileEntry(name: string, file: string, sums: { size: number; crc32: number }) {
  return {
    name,
    ...sums,
    data: () => createReadStream(file) as AsyncIterable<Uint8Array>,
  } satisfies ZipSource;
}

/** `force64` writes the ZIP64 records even where nothing needs them (tests read them so). */
interface WriteOptions {
  force64?: boolean;
}

/** Where each entry's local header starts, its fields' sizes, and the zip's length. */
function layout(entries: ReadonlyArray<{ name: string; size: number }>, options: WriteOptions) {
  let at = 0;
  let directory = 0;
  const placed = entries.map((e) => {
    const name = Buffer.from(e.name, "utf8");
    const big = options.force64 || e.size >= MAX32;
    const far = options.force64 || at >= MAX32;
    const local = { at, name, big, far };
    at += LOCAL_HEADER + name.length + (big ? 20 : 0) + e.size;
    const fields = (big ? 2 : 0) + (far ? 1 : 0);
    directory += CENTRAL_HEADER + name.length + (fields ? 4 + 8 * fields : 0);
    return local;
  });
  const zip64 = !!options.force64 || entries.length >= MAX16 || at >= MAX32 || directory >= MAX32;
  return {
    placed,
    directoryAt: at,
    directory,
    zip64,
    bytes: at + directory + (zip64 ? ZIP64_END + ZIP64_LOCATOR : 0) + END_RECORD,
  };
}

/** The length of the zip `zipStream` writes of these entries. */
export const zipLength = (
  entries: ReadonlyArray<{ name: string; size: number }>,
  options: WriteOptions = {},
) => layout(entries, options).bytes;

/**
 * The zip of `entries` in their order, as chunks: each entry's local header (sizes and CRC-32 in it,
 * no data descriptor), its bytes — exactly as many as it said, else it fails —, then the directory and
 * the end records. Its length is `zipLength` of the same entries.
 */
export async function* zipStream(
  entries: readonly ZipSource[],
  options: WriteOptions = {},
): AsyncGenerator<Uint8Array> {
  const plan = layout(entries, options);
  for (const [i, e] of entries.entries()) {
    const { name, big } = plan.placed[i] as (typeof plan.placed)[number];
    const head = Buffer.alloc(LOCAL_HEADER + name.length + (big ? 20 : 0));
    head.writeUInt32LE(SIG.local, 0);
    head.writeUInt16LE(big ? 45 : 20, 4);
    head.writeUInt16LE(UTF8, 6);
    head.writeUInt16LE(DOS_DATE, 12);
    head.writeUInt32LE(e.crc32 >>> 0, 14);
    head.writeUInt32LE(big ? MAX32 : e.size, 18);
    head.writeUInt32LE(big ? MAX32 : e.size, 22);
    head.writeUInt16LE(name.length, 26);
    head.writeUInt16LE(big ? 20 : 0, 28);
    name.copy(head, LOCAL_HEADER);
    if (big) {
      const extra = LOCAL_HEADER + name.length;
      head.writeUInt16LE(ZIP64_EXTRA, extra);
      head.writeUInt16LE(16, extra + 2);
      head.writeBigUInt64LE(BigInt(e.size), extra + 4);
      head.writeBigUInt64LE(BigInt(e.size), extra + 12);
    }
    yield head;
    let written = 0;
    for await (const chunk of e.data()) {
      written += chunk.byteLength;
      if (written > e.size) break;
      yield chunk;
    }
    if (written !== e.size) throw new Error(`${e.name} changed while it was written`);
  }
  const directory = Buffer.alloc(plan.directory);
  let p = 0;
  for (const [i, e] of entries.entries()) {
    const { name, big, far, at } = plan.placed[i] as (typeof plan.placed)[number];
    const fields = [...(big ? [e.size, e.size] : []), ...(far ? [at] : [])];
    directory.writeUInt32LE(SIG.central, p);
    directory.writeUInt16LE(45, p + 4);
    directory.writeUInt16LE(fields.length ? 45 : 20, p + 6);
    directory.writeUInt16LE(UTF8, p + 8);
    directory.writeUInt16LE(DOS_DATE, p + 14);
    directory.writeUInt32LE(e.crc32 >>> 0, p + 16);
    directory.writeUInt32LE(big ? MAX32 : e.size, p + 20);
    directory.writeUInt32LE(big ? MAX32 : e.size, p + 24);
    directory.writeUInt16LE(name.length, p + 28);
    directory.writeUInt16LE(fields.length ? 4 + 8 * fields.length : 0, p + 30);
    directory.writeUInt32LE(far ? MAX32 : at, p + 42);
    name.copy(directory, p + CENTRAL_HEADER);
    p += CENTRAL_HEADER + name.length;
    if (fields.length) {
      directory.writeUInt16LE(ZIP64_EXTRA, p);
      directory.writeUInt16LE(8 * fields.length, p + 2);
      for (const [n, f] of fields.entries()) directory.writeBigUInt64LE(BigInt(f), p + 4 + 8 * n);
      p += 4 + 8 * fields.length;
    }
  }
  yield directory;
  const count = entries.length;
  const end = Buffer.alloc((plan.zip64 ? ZIP64_END + ZIP64_LOCATOR : 0) + END_RECORD);
  let q = 0;
  if (plan.zip64) {
    const recordAt = plan.directoryAt + plan.directory;
    end.writeUInt32LE(SIG.zip64End, 0);
    end.writeBigUInt64LE(BigInt(ZIP64_END - 12), 4);
    end.writeUInt16LE(45, 12);
    end.writeUInt16LE(45, 14);
    end.writeBigUInt64LE(BigInt(count), 24);
    end.writeBigUInt64LE(BigInt(count), 32);
    end.writeBigUInt64LE(BigInt(plan.directory), 40);
    end.writeBigUInt64LE(BigInt(plan.directoryAt), 48);
    end.writeUInt32LE(SIG.zip64Locator, ZIP64_END);
    end.writeBigUInt64LE(BigInt(recordAt), ZIP64_END + 8);
    end.writeUInt32LE(1, ZIP64_END + 16);
    q = ZIP64_END + ZIP64_LOCATOR;
  }
  end.writeUInt32LE(SIG.end, q);
  end.writeUInt16LE(plan.zip64 ? MAX16 : count, q + 8);
  end.writeUInt16LE(plan.zip64 ? MAX16 : count, q + 10);
  end.writeUInt32LE(plan.zip64 ? MAX32 : plan.directory, q + 12);
  end.writeUInt32LE(plan.zip64 ? MAX32 : plan.directoryAt, q + 16);
  yield end;
}

/** An entry as the directory gives it, checked: its name, where its bytes start, their size. */
export interface ZipEntry {
  name: string;
  start: number;
  size: number;
}

/** How much of a zip is believed: each field (name, extra field, comment) at most `fieldMax` bytes,
 *  the directory at most `directoryMax`. */
export interface ZipLimits {
  fieldMax: number;
  directoryMax: number;
}

/** The ZIP64 extra field's values, each in place of a 32-bit field that holds MAX32; undefined when
 *  the extra field is anything else (only that block, exactly filled). */
function zip64Values(extra: Buffer, wanted: number) {
  if (!wanted && !extra.length) return [];
  if (extra.length !== 4 + 8 * wanted || extra.readUInt16LE(0) !== ZIP64_EXTRA) return undefined;
  if (extra.readUInt16LE(2) !== 8 * wanted) return undefined;
  const values: number[] = [];
  for (let n = 0; n < wanted; n++) {
    const value = extra.readBigUInt64LE(4 + 8 * n);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
    values.push(Number(value));
  }
  return values;
}

/**
 * A zip's entries by its central directory. Nothing it says is trusted further than it is checked:
 * the end record runs to the end of the file, one disk, the directory right before it (or before the
 * ZIP64 end record, which sits right before its locator) and no larger than its entries need; each
 * entry stored (not compressed, not encrypted), short fields, ZIP64 values only where a field says so,
 * its local header the same (name, flags, sizes — or none, with a data descriptor), and the entries in
 * order, none overlapping another or the directory. Undefined when it is no such zip.
 */
export function zipEntries(file: string, limits: ZipLimits): ZipEntry[] | undefined {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const at = (bytes: number, position: number) => {
      if (position < 0 || position + bytes > size) return undefined;
      const buffer = Buffer.alloc(bytes);
      return readSync(fd, buffer, 0, bytes, position) === bytes ? buffer : undefined;
    };
    const tailBytes = Math.min(size, END_RECORD + MAX16);
    const tailAt = size - tailBytes;
    const tail = at(tailBytes, tailAt);
    if (!tail) return undefined;
    let end = -1;
    for (let i = tailBytes - END_RECORD; i >= 0 && end < 0; i--)
      if (
        tail.readUInt32LE(i) === SIG.end &&
        i + END_RECORD + tail.readUInt16LE(i + 20) === tailBytes
      )
        end = i;
    if (end < 0) return undefined;
    const endAt = tailAt + end;
    let count = tail.readUInt16LE(end + 10);
    let dirBytes = tail.readUInt32LE(end + 12);
    let dirAt = tail.readUInt32LE(end + 16);
    if (
      tail.readUInt16LE(end + 4) !== 0 ||
      tail.readUInt16LE(end + 6) !== 0 ||
      tail.readUInt16LE(end + 8) !== count
    )
      return undefined;
    // Where the directory must end: at the end record, or at the ZIP64 one.
    let dirEnd = endAt;
    if (count === MAX16 || dirBytes === MAX32 || dirAt === MAX32) {
      const locator = at(ZIP64_LOCATOR, endAt - ZIP64_LOCATOR);
      if (
        locator?.readUInt32LE(0) !== SIG.zip64Locator ||
        locator.readUInt32LE(4) !== 0 ||
        locator.readUInt32LE(16) !== 1
      )
        return undefined;
      const recordAt = locator.readBigUInt64LE(8);
      if (recordAt !== BigInt(endAt - ZIP64_LOCATOR - ZIP64_END)) return undefined;
      const record = at(ZIP64_END, Number(recordAt));
      if (
        record?.readUInt32LE(0) !== SIG.zip64End ||
        record.readBigUInt64LE(4) !== BigInt(ZIP64_END - 12) ||
        record.readUInt32LE(16) !== 0 ||
        record.readUInt32LE(20) !== 0 ||
        record.readBigUInt64LE(24) !== record.readBigUInt64LE(32)
      )
        return undefined;
      const big = [32, 40, 48].map((o) => record.readBigUInt64LE(o));
      if (big.some((v) => v > BigInt(Number.MAX_SAFE_INTEGER))) return undefined;
      [count, dirBytes, dirAt] = big.map(Number) as [number, number, number];
      dirEnd = Number(recordAt);
    }
    if (
      dirAt + dirBytes !== dirEnd ||
      dirBytes > Math.min(limits.directoryMax, count * (CENTRAL_HEADER + 3 * limits.fieldMax))
    )
      return undefined;
    const dir = at(dirBytes, dirAt);
    if (!dir) return undefined;
    const entries: ZipEntry[] = [];
    // Where the next entry may start: after the one before it, data descriptor and all.
    let free = 0;
    let p = 0;
    for (let n = 0; n < count; n++) {
      if (p + CENTRAL_HEADER > dirBytes || dir.readUInt32LE(p) !== SIG.central) return undefined;
      const flags = dir.readUInt16LE(p + 8);
      const method = dir.readUInt16LE(p + 10);
      const fields = [p + 28, p + 30, p + 32].map((f) => dir.readUInt16LE(f));
      const [nameBytes = 0, extraBytes = 0, commentBytes = 0] = fields;
      if (fields.some((f) => f > limits.fieldMax)) return undefined;
      if (p + CENTRAL_HEADER + nameBytes + extraBytes + commentBytes > dirBytes) return undefined;
      const name = dir.subarray(p + CENTRAL_HEADER, p + CENTRAL_HEADER + nameBytes);
      const extra = dir.subarray(
        p + CENTRAL_HEADER + nameBytes,
        p + CENTRAL_HEADER + nameBytes + extraBytes,
      );
      // The 32-bit sizes and offset; those holding MAX32 are in the ZIP64 field, in this order.
      const small = [dir.readUInt32LE(p + 24), dir.readUInt32LE(p + 20), dir.readUInt32LE(p + 42)];
      const values = zip64Values(extra, small.filter((v) => v === MAX32).length);
      if (!values) return undefined;
      const [length, stored, local] = small.map((v) => (v === MAX32 ? values.shift() : v)) as [
        number,
        number,
        number,
      ];
      p += CENTRAL_HEADER + nameBytes + extraBytes + commentBytes;
      if (flags & 1 || method !== 0 || stored !== length || local < free) return undefined;
      const localExtra = at(2, local + 28)?.readUInt16LE(0) ?? MAX16;
      if (localExtra > limits.fieldMax) return undefined;
      const head = at(LOCAL_HEADER + nameBytes + localExtra, local);
      if (
        head?.readUInt32LE(0) !== SIG.local ||
        head.readUInt16LE(6) !== flags ||
        head.readUInt16LE(8) !== 0 ||
        head.readUInt16LE(26) !== nameBytes ||
        !head.subarray(LOCAL_HEADER, LOCAL_HEADER + nameBytes).equals(name)
      )
        return undefined;
      // Sizes in the local header (or its ZIP64 field), or none there and a data descriptor after
      // the data (32-bit: never written for an entry needing ZIP64).
      const described = (flags & 8) !== 0;
      const sizes = [head.readUInt32LE(18), head.readUInt32LE(22)];
      const sized =
        sizes.every((s) => s === length) ||
        (described && length < MAX32 && sizes.every((s) => s === 0)) ||
        (sizes.every((s) => s === MAX32) &&
          zip64Values(head.subarray(LOCAL_HEADER + nameBytes), 2)?.every((s) => s === length));
      if (!sized) return undefined;
      const start = local + LOCAL_HEADER + nameBytes + localExtra;
      free = start + length;
      if (described) free += at(4, free)?.readUInt32LE(0) === SIG.descriptor ? 16 : 12;
      if (free > dirAt) return undefined;
      entries.push({ name: name.toString("utf8"), start, size: length });
    }
    return p === dirBytes ? entries : undefined;
  } finally {
    closeSync(fd);
  }
}

/** An entry's bytes, as they are in the file. */
export const entryStream = (file: string, entry: ZipEntry) =>
  (entry.size
    ? createReadStream(file, { start: entry.start, end: entry.start + entry.size - 1 })
    : []) as AsyncIterable<Uint8Array>;

/** An entry's bytes read whole (a manifest: small, its size checked before). */
export function entryBytes(file: string, entry: ZipEntry) {
  const fd = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(entry.size);
    readSync(fd, buffer, 0, entry.size, entry.start);
    return buffer;
  } finally {
    closeSync(fd);
  }
}

/** Chunks written to a new file, hashed on the way; past `max` bytes it stops: undefined. */
export async function writeChunks(
  file: string,
  chunks: AsyncIterable<Uint8Array>,
  max = Number.POSITIVE_INFINITY,
  mode = 0o666,
) {
  await mkdir(dirname(file), { recursive: true });
  const handle = await open(file, "w", mode);
  const hash = createHash("sha256");
  let size = 0;
  try {
    for await (const chunk of chunks) {
      size += chunk.byteLength;
      if (size > max) return undefined;
      hash.update(chunk);
      await handle.write(chunk);
    }
  } finally {
    await handle.close();
  }
  return { sha256: hash.digest("hex"), size };
}
