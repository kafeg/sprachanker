// Zips of stored entries — the files that move a course or a profile between one's machines:
// written with every size and checksum known before an entry starts (ZIP64 where a size or an offset
// needs it), and read by their directory only as far as it is checked — or, as they come (a course
// bundle), entry by entry by the sizes their headers give, then the directory checked against every
// entry read. Untrusted files are read here, so nothing a zip says is believed beyond what is checked
// against the rest of it.
import type { DataFs } from "./data-fs.ts";
import { crc32 } from "./hash.ts";

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

/** Little-endian fields of bytes, read and written (what a zip's headers are made of). */
class Fields {
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  static alloc(size: number) {
    return new Fields(new Uint8Array(size));
  }
  get length() {
    return this.bytes.length;
  }
  u16 = (at: number) => this.view.getUint16(at, true);
  u32 = (at: number) => this.view.getUint32(at, true);
  u64 = (at: number) => this.view.getBigUint64(at, true);
  set16 = (value: number, at: number) => this.view.setUint16(at, value, true);
  set32 = (value: number, at: number) => this.view.setUint32(at, value >>> 0, true);
  set64 = (value: bigint, at: number) => this.view.setBigUint64(at, value, true);
  sub = (start: number, end?: number) => new Fields(this.bytes.subarray(start, end));
  put(bytes: Uint8Array, at: number) {
    this.bytes.set(bytes, at);
  }
}

const utf8 = (text: string) => new TextEncoder().encode(text);
const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** A file's sha256, size and CRC-32 (the zip's own check), read as a stream. */
export const fileSums = (fs: DataFs, file: string) => fs.sums(file);

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

/** A file on disk as an entry, its size and CRC-32 as summed before (`fileSums`). Given its time of
 *  change then (`mtimeMs`), a file not as it was summed — replaced, changed — before or after its
 *  bytes are read fails the zip (code ECHANGED). */
export function fileEntry(
  fs: DataFs,
  name: string,
  file: string,
  sums: { size: number; crc32: number; mtimeMs?: number },
) {
  const { size, crc32, mtimeMs } = sums;
  const same = () => {
    const now = fs.stat(file);
    if (mtimeMs !== undefined && (now?.size !== size || now.mtimeMs !== mtimeMs))
      throw Object.assign(new Error(`${file} changed after it was summed`), { code: "ECHANGED" });
  };
  async function* data() {
    same();
    yield* fs.stream(file);
    same();
  }
  return { name, size, crc32, data } satisfies ZipSource;
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
    const name = utf8(e.name);
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
    const head = Fields.alloc(LOCAL_HEADER + name.length + (big ? 20 : 0));
    head.set32(SIG.local, 0);
    head.set16(big ? 45 : 20, 4);
    head.set16(UTF8, 6);
    head.set16(DOS_DATE, 12);
    head.set32(e.crc32 >>> 0, 14);
    head.set32(big ? MAX32 : e.size, 18);
    head.set32(big ? MAX32 : e.size, 22);
    head.set16(name.length, 26);
    head.set16(big ? 20 : 0, 28);
    head.put(name, LOCAL_HEADER);
    if (big) {
      const extra = LOCAL_HEADER + name.length;
      head.set16(ZIP64_EXTRA, extra);
      head.set16(16, extra + 2);
      head.set64(BigInt(e.size), extra + 4);
      head.set64(BigInt(e.size), extra + 12);
    }
    yield head.bytes;
    let written = 0;
    for await (const chunk of e.data()) {
      written += chunk.byteLength;
      if (written > e.size) break;
      yield chunk;
    }
    if (written !== e.size) throw new Error(`${e.name} changed while it was written`);
  }
  const directory = Fields.alloc(plan.directory);
  let p = 0;
  for (const [i, e] of entries.entries()) {
    const { name, big, far, at } = plan.placed[i] as (typeof plan.placed)[number];
    const fields = [...(big ? [e.size, e.size] : []), ...(far ? [at] : [])];
    directory.set32(SIG.central, p);
    directory.set16(45, p + 4);
    directory.set16(fields.length ? 45 : 20, p + 6);
    directory.set16(UTF8, p + 8);
    directory.set16(DOS_DATE, p + 14);
    directory.set32(e.crc32 >>> 0, p + 16);
    directory.set32(big ? MAX32 : e.size, p + 20);
    directory.set32(big ? MAX32 : e.size, p + 24);
    directory.set16(name.length, p + 28);
    directory.set16(fields.length ? 4 + 8 * fields.length : 0, p + 30);
    directory.set32(far ? MAX32 : at, p + 42);
    directory.put(name, p + CENTRAL_HEADER);
    p += CENTRAL_HEADER + name.length;
    if (fields.length) {
      directory.set16(ZIP64_EXTRA, p);
      directory.set16(8 * fields.length, p + 2);
      for (const [n, f] of fields.entries()) directory.set64(BigInt(f), p + 4 + 8 * n);
      p += 4 + 8 * fields.length;
    }
  }
  yield directory.bytes;
  const count = entries.length;
  const end = Fields.alloc((plan.zip64 ? ZIP64_END + ZIP64_LOCATOR : 0) + END_RECORD);
  let q = 0;
  if (plan.zip64) {
    const recordAt = plan.directoryAt + plan.directory;
    end.set32(SIG.zip64End, 0);
    end.set64(BigInt(ZIP64_END - 12), 4);
    end.set16(45, 12);
    end.set16(45, 14);
    end.set64(BigInt(count), 24);
    end.set64(BigInt(count), 32);
    end.set64(BigInt(plan.directory), 40);
    end.set64(BigInt(plan.directoryAt), 48);
    end.set32(SIG.zip64Locator, ZIP64_END);
    end.set64(BigInt(recordAt), ZIP64_END + 8);
    end.set32(1, ZIP64_END + 16);
    q = ZIP64_END + ZIP64_LOCATOR;
  }
  end.set32(SIG.end, q);
  end.set16(plan.zip64 ? MAX16 : count, q + 8);
  end.set16(plan.zip64 ? MAX16 : count, q + 10);
  end.set32(plan.zip64 ? MAX32 : plan.directory, q + 12);
  end.set32(plan.zip64 ? MAX32 : plan.directoryAt, q + 16);
  yield end.bytes;
}

/** An entry as the directory gives it, checked: its name, where its bytes start, their size. */
export interface ZipEntry {
  name: string;
  start: number;
  size: number;
}

/** How much of a zip is believed: at most `countMax` entries, each field (name, extra field, comment)
 *  at most `fieldMax` bytes, the directory at most `directoryMax` — all checked before the directory
 *  is read. */
export interface ZipLimits {
  countMax: number;
  fieldMax: number;
  directoryMax: number;
}

/** The limits of a zip of at most `files` entries, names at most `nameMax` bytes: its directory as
 *  large as entries of names `nameAverage` bytes long on average need (with ZIP64 fields, no comment). */
export const zipLimits = (files: number, nameMax: number, nameAverage: number): ZipLimits => ({
  countMax: files,
  fieldMax: nameMax,
  directoryMax: files * (CENTRAL_HEADER + 4 + 3 * 8 + nameAverage),
});

/** The ZIP64 extra field's values, each in place of a 32-bit field that holds MAX32; undefined when
 *  the extra field is anything else (only that block, exactly filled). */
function zip64Values(extra: Fields, wanted: number) {
  if (!wanted && !extra.length) return [];
  if (extra.length !== 4 + 8 * wanted || extra.u16(0) !== ZIP64_EXTRA) return undefined;
  if (extra.u16(2) !== 8 * wanted) return undefined;
  const values: number[] = [];
  for (let n = 0; n < wanted; n++) {
    const value = extra.u64(4 + 8 * n);
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
export function zipEntries(fs: DataFs, file: string, limits: ZipLimits): ZipEntry[] | undefined {
  {
    const size = fs.stat(file)?.size ?? 0;
    const at = (bytes: number, position: number) => {
      if (position < 0 || position + bytes > size) return undefined;
      const read = fs.readBytes(file, position, bytes);
      return read?.length === bytes ? new Fields(read) : undefined;
    };
    const tailBytes = Math.min(size, END_RECORD + MAX16);
    const tailAt = size - tailBytes;
    const tail = at(tailBytes, tailAt);
    if (!tail) return undefined;
    let end = -1;
    for (let i = tailBytes - END_RECORD; i >= 0 && end < 0; i--)
      if (tail.u32(i) === SIG.end && i + END_RECORD + tail.u16(i + 20) === tailBytes) end = i;
    if (end < 0) return undefined;
    const endAt = tailAt + end;
    let count = tail.u16(end + 10);
    let dirBytes = tail.u32(end + 12);
    let dirAt = tail.u32(end + 16);
    if (tail.u16(end + 4) !== 0 || tail.u16(end + 6) !== 0 || tail.u16(end + 8) !== count)
      return undefined;
    // Where the directory must end: at the end record, or at the ZIP64 one.
    let dirEnd = endAt;
    if (count === MAX16 || dirBytes === MAX32 || dirAt === MAX32) {
      const locator = at(ZIP64_LOCATOR, endAt - ZIP64_LOCATOR);
      if (locator?.u32(0) !== SIG.zip64Locator || locator.u32(4) !== 0 || locator.u32(16) !== 1)
        return undefined;
      const recordAt = locator.u64(8);
      if (recordAt !== BigInt(endAt - ZIP64_LOCATOR - ZIP64_END)) return undefined;
      const record = at(ZIP64_END, Number(recordAt));
      if (
        record?.u32(0) !== SIG.zip64End ||
        record.u64(4) !== BigInt(ZIP64_END - 12) ||
        record.u32(16) !== 0 ||
        record.u32(20) !== 0 ||
        record.u64(24) !== record.u64(32)
      )
        return undefined;
      const big = [32, 40, 48].map((o) => record.u64(o));
      if (big.some((v) => v > BigInt(Number.MAX_SAFE_INTEGER))) return undefined;
      [count, dirBytes, dirAt] = big.map(Number) as [number, number, number];
      dirEnd = Number(recordAt);
    }
    if (
      count > limits.countMax ||
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
      if (p + CENTRAL_HEADER > dirBytes || dir.u32(p) !== SIG.central) return undefined;
      const flags = dir.u16(p + 8);
      const method = dir.u16(p + 10);
      const fields = [p + 28, p + 30, p + 32].map((f) => dir.u16(f));
      const [nameBytes = 0, extraBytes = 0, commentBytes = 0] = fields;
      if (fields.some((f) => f > limits.fieldMax)) return undefined;
      if (p + CENTRAL_HEADER + nameBytes + extraBytes + commentBytes > dirBytes) return undefined;
      const name = dir.bytes.subarray(p + CENTRAL_HEADER, p + CENTRAL_HEADER + nameBytes);
      const extra = dir.sub(
        p + CENTRAL_HEADER + nameBytes,
        p + CENTRAL_HEADER + nameBytes + extraBytes,
      );
      // The 32-bit sizes and offset; those holding MAX32 are in the ZIP64 field, in this order.
      const small = [dir.u32(p + 24), dir.u32(p + 20), dir.u32(p + 42)];
      const values = zip64Values(extra, small.filter((v) => v === MAX32).length);
      if (!values) return undefined;
      const [length, stored, local] = small.map((v) => (v === MAX32 ? values.shift() : v)) as [
        number,
        number,
        number,
      ];
      p += CENTRAL_HEADER + nameBytes + extraBytes + commentBytes;
      if (flags & 1 || method !== 0 || stored !== length || local < free) return undefined;
      const localExtra = at(2, local + 28)?.u16(0) ?? MAX16;
      if (localExtra > limits.fieldMax) return undefined;
      const head = at(LOCAL_HEADER + nameBytes + localExtra, local);
      if (
        head?.u32(0) !== SIG.local ||
        head.u16(6) !== flags ||
        head.u16(8) !== 0 ||
        head.u16(26) !== nameBytes ||
        !same(head.bytes.subarray(LOCAL_HEADER, LOCAL_HEADER + nameBytes), name)
      )
        return undefined;
      // Sizes in the local header (or its ZIP64 field), or none there and a data descriptor after
      // the data (32-bit: never written for an entry needing ZIP64).
      const described = (flags & 8) !== 0;
      const sizes = [head.u32(18), head.u32(22)];
      const sized =
        sizes.every((s) => s === length) ||
        (described && length < MAX32 && sizes.every((s) => s === 0)) ||
        (sizes.every((s) => s === MAX32) &&
          zip64Values(head.sub(LOCAL_HEADER + nameBytes), 2)?.every((s) => s === length));
      if (!sized) return undefined;
      const start = local + LOCAL_HEADER + nameBytes + localExtra;
      free = start + length;
      if (described) free += at(4, free)?.u32(0) === SIG.descriptor ? 16 : 12;
      if (free > dirAt) return undefined;
      entries.push({ name: new TextDecoder().decode(name), start, size: length });
    }
    return p === dirBytes ? entries : undefined;
  }
}

/** A zip read as it comes that is no zip of stored entries as written here (code EBADZIP). */
const badZip = (why: string) => Object.assign(new Error(`not a zip: ${why}`), { code: "EBADZIP" });

/** Bytes as they come, taken exactly: so many at once (a header), or passed on in their chunks. */
class Incoming {
  private readonly it: AsyncIterator<Uint8Array>;
  private chunks: Uint8Array[] = [];
  private held = 0;
  private ended = false;
  /** Bytes taken so far: where the next one is in the zip. */
  at = 0;
  constructor(source: AsyncIterable<Uint8Array>) {
    this.it = source[Symbol.asyncIterator]();
  }
  /** At least `n` bytes held, unless the bytes end first. */
  private async fill(n: number) {
    while (this.held < n && !this.ended) {
      const next = await this.it.next();
      if (next.done) this.ended = true;
      else if (next.value.byteLength) {
        this.chunks.push(next.value);
        this.held += next.value.byteLength;
      }
    }
    return this.held >= n;
  }
  /** The next `n` bytes at once (a header, a name; never an entry's data). */
  async take(n: number) {
    if (!(await this.fill(n))) throw badZip("it ends early");
    const out = new Uint8Array(n);
    let got = 0;
    while (got < n) {
      const chunk = this.chunks[0] as Uint8Array;
      const part = Math.min(n - got, chunk.byteLength);
      out.set(chunk.subarray(0, part), got);
      got += part;
      if (part === chunk.byteLength) this.chunks.shift();
      else this.chunks[0] = chunk.subarray(part);
    }
    this.held -= n;
    this.at += n;
    return new Fields(out);
  }
  /** The next `n` bytes in the chunks they come in, none copied. */
  async *pass(n: number): AsyncGenerator<Uint8Array> {
    let left = n;
    while (left > 0) {
      if (!this.held && !(await this.fill(1))) throw badZip("it ends early");
      const chunk = this.chunks[0] as Uint8Array;
      const part = Math.min(left, chunk.byteLength);
      if (part === chunk.byteLength) this.chunks.shift();
      else this.chunks[0] = chunk.subarray(part);
      this.held -= part;
      this.at += part;
      left -= part;
      yield chunk.subarray(0, part);
    }
  }
  /** Whether no byte is left. */
  async atEnd() {
    return !(await this.fill(1));
  }
  close() {
    // Not waited for: a source's return may wait for a read that stalled.
    this.it.return?.()?.catch(() => {});
  }
}

/** An entry of a zip read as it comes: its name and size, then its bytes — read or not: the next
 *  entry passes by what was left of them. */
export interface ZipEntryRead {
  name: string;
  size: number;
  data: AsyncIterable<Uint8Array>;
}

/**
 * A zip's entries as its bytes come, in their order. Each local header is checked (stored, not
 * encrypted, no data descriptor: its size in the header, ZIP64 only as a size needs it; fields no
 * longer than `limits.fieldMax`) and its bytes passed on by that size, so nothing inside an entry is
 * ever taken for a header. After the last entry the directory and end records are read and checked
 * against every entry read (names, flags, CRC-32, sizes, offsets, how many; the directory no larger
 * than they need, at most `limits.directoryMax`), and the bytes must end there. Any other bytes fail
 * with code EBADZIP — possibly after entries were yielded: what was taken of them is believed only
 * once the zip has ended whole. At most `limits.countMax` entries.
 */
export async function* zipRead(
  source: AsyncIterable<Uint8Array>,
  limits: ZipLimits,
): AsyncGenerator<ZipEntryRead> {
  const bytes = new Incoming(source);
  const read: Array<{ at: number; name: Uint8Array; flags: number; crc: number; size: number }> =
    [];
  try {
    let sig = (await bytes.take(4)).u32(0);
    while (sig === SIG.local) {
      const at = bytes.at - 4;
      if (read.length >= limits.countMax) throw badZip("too many entries");
      // A local header after its signature.
      const head = await bytes.take(LOCAL_HEADER - 4);
      const flags = head.u16(2);
      const nameBytes = head.u16(22);
      const extraBytes = head.u16(24);
      if (flags & ~UTF8 || head.u16(4) !== 0) throw badZip("an entry not stored as written here");
      if (nameBytes > limits.fieldMax || extraBytes > limits.fieldMax)
        throw badZip("a field too long");
      const name = (await bytes.take(nameBytes)).bytes;
      const extra = await bytes.take(extraBytes);
      const small = [head.u32(14), head.u32(18)];
      const values = zip64Values(extra, small.filter((v) => v === MAX32).length);
      if (!values || (values.length && values.length !== 2)) throw badZip("an entry's sizes");
      const [stored, length] = small.map((v) => (v === MAX32 ? values.shift() : v)) as [
        number,
        number,
      ];
      if (stored !== length) throw badZip("an entry's sizes");
      read.push({ at, name, flags, crc: head.u32(10), size: length });
      let left = length;
      const data = (async function* () {
        for await (const chunk of bytes.pass(left)) {
          left -= chunk.byteLength;
          yield chunk;
        }
      })();
      yield { name: new TextDecoder().decode(name), size: length, data };
      // What the reader left of it passes by.
      await data.return(undefined);
      for await (const chunk of bytes.pass(left)) left -= chunk.byteLength;
      sig = (await bytes.take(4)).u32(0);
    }
    // The directory: an entry for each entry read, the same.
    const dirAt = bytes.at - 4;
    const dirMax = Math.min(
      limits.directoryMax,
      read.length * (CENTRAL_HEADER + 3 * limits.fieldMax),
    );
    for (const entry of read) {
      if (sig !== SIG.central) throw badZip("its directory");
      // A directory entry after its signature.
      const head = await bytes.take(CENTRAL_HEADER - 4);
      const fields = [head.u16(24), head.u16(26), head.u16(28)];
      const [nameBytes = 0, extraBytes = 0, commentBytes = 0] = fields;
      if (fields.some((f) => f > limits.fieldMax)) throw badZip("a field too long");
      const name = (await bytes.take(nameBytes)).bytes;
      const extra = await bytes.take(extraBytes);
      await bytes.take(commentBytes);
      if (bytes.at - dirAt > dirMax) throw badZip("its directory too large");
      const small = [head.u32(20), head.u32(16), head.u32(38)];
      const values = zip64Values(extra, small.filter((v) => v === MAX32).length);
      if (!values) throw badZip("its directory");
      const [length, stored, local] = small.map((v) => (v === MAX32 ? values.shift() : v));
      if (
        !same(name, entry.name) ||
        head.u16(4) !== entry.flags ||
        head.u16(6) !== 0 ||
        head.u32(12) !== entry.crc ||
        length !== entry.size ||
        stored !== entry.size ||
        local !== entry.at
      )
        throw badZip("its directory is not its entries");
      sig = (await bytes.take(4)).u32(0);
    }
    const dirBytes = bytes.at - 4 - dirAt;
    // The ZIP64 end record and its locator, where a value needs them.
    const zip64 = sig === SIG.zip64End;
    if (zip64) {
      const recordAt = bytes.at - 4;
      const record = await bytes.take(ZIP64_END - 4);
      const locator = await bytes.take(ZIP64_LOCATOR);
      if (
        record.u64(0) !== BigInt(ZIP64_END - 12) ||
        record.u32(12) !== 0 ||
        record.u32(16) !== 0 ||
        record.u64(20) !== BigInt(read.length) ||
        record.u64(28) !== BigInt(read.length) ||
        record.u64(36) !== BigInt(dirBytes) ||
        record.u64(44) !== BigInt(dirAt) ||
        locator.u32(0) !== SIG.zip64Locator ||
        locator.u32(4) !== 0 ||
        locator.u64(8) !== BigInt(recordAt) ||
        locator.u32(16) !== 1
      )
        throw badZip("its ZIP64 end");
      sig = (await bytes.take(4)).u32(0);
    }
    if (sig !== SIG.end) throw badZip("its end");
    const end = await bytes.take(END_RECORD - 4);
    // Each value as it is, or (with the ZIP64 record) the mark that says it is there.
    const says = (value: number, actual: number, mark: number) =>
      value === actual || (zip64 && value === mark);
    if (
      end.u16(0) !== 0 ||
      end.u16(2) !== 0 ||
      end.u16(4) !== end.u16(6) ||
      !says(end.u16(6), read.length, MAX16) ||
      !says(end.u32(8), dirBytes, MAX32) ||
      !says(end.u32(12), dirAt, MAX32)
    )
      throw badZip("its end");
    await bytes.take(end.u16(16));
    if (!(await bytes.atEnd())) throw badZip("bytes after its end");
  } finally {
    bytes.close();
  }
}

/** An entry's bytes, as they are in the file. */
export const entryStream = (
  fs: DataFs,
  file: string,
  entry: ZipEntry,
): AsyncIterable<Uint8Array> =>
  entry.size
    ? fs.stream(file, entry.start, entry.start + entry.size - 1)
    : (async function* () {})();

/** An entry's bytes read whole (a manifest: small, its size checked before). */
export const entryBytes = (fs: DataFs, file: string, entry: ZipEntry) =>
  fs.readBytes(file, entry.start, entry.size) ?? new Uint8Array();

/** An entry's text (UTF-8). */
export const entryText = (fs: DataFs, file: string, entry: ZipEntry) =>
  new TextDecoder().decode(entryBytes(fs, file, entry));

/** Chunks written to a new file, hashed on the way; past `max` bytes it stops: undefined. */
export const writeChunks = (
  fs: DataFs,
  file: string,
  chunks: AsyncIterable<Uint8Array>,
  max = Number.POSITIVE_INFINITY,
  mode = 0o666,
) => fs.write(file, chunks, { max, mode });
