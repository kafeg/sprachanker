// bzip2 decompressed in TypeScript (Piper's voices come as .tar.bz2, and Windows' own tar has no
// bzip2): block by block — the event loop let go between blocks, so the server goes on answering —,
// each block's CRC and the stream's checked, concatenated streams (as pbzip2 writes) read on.
// The format: Julian Seward's bzip2 (BWT, MTF, Huffman, two run-length stages).

const BLOCK_MAGIC_HI = 0x314159;
const BLOCK_MAGIC_LO = 0x265359;
const END_MAGIC_HI = 0x177245;
const END_MAGIC_LO = 0x385090;
const MAX_GROUPS = 6;
const GROUP_SIZE = 50;
const MAX_CODE_LEN = 20;

/** bzip2's CRC-32: the polynomial 0x04c11db7, most significant bit first. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 24;
    for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
    table[i] = c >>> 0;
  }
  return table;
})();

class Bits {
  private pos = 0;
  private buf = 0;
  private count = 0;
  constructor(private readonly data: Uint8Array) {}

  /** `n` bits (at most 24), most significant first. */
  read(n: number): number {
    while (this.count < n) {
      if (this.pos >= this.data.length) throw new Error("bzip2: the data ends early");
      this.buf = ((this.buf << 8) | (this.data[this.pos++] as number)) >>> 0;
      this.count += 8;
    }
    this.count -= n;
    return (this.buf >>> this.count) & ((1 << n) - 1);
  }

  bit(): number {
    return this.read(1);
  }

  read32(): number {
    return ((this.read(16) << 16) | this.read(16)) >>> 0;
  }

  /** The bits left in the current byte dropped (a stream's end is padded to a byte). */
  align() {
    this.count -= this.count % 8;
  }

  /** Whether another byte follows. */
  more() {
    return this.count >= 8 || this.pos < this.data.length;
  }
}

/** A canonical Huffman table as bzip2 assigns its codes (by length, then by symbol). */
interface Table {
  count: Uint16Array;
  symbol: Uint16Array;
  maxLen: number;
}

function table(lengths: Uint8Array, alphaSize: number): Table {
  const count = new Uint16Array(MAX_CODE_LEN + 1);
  for (let i = 0; i < alphaSize; i++) {
    const len = lengths[i] as number;
    count[len] = (count[len] as number) + 1;
  }
  const offs = new Uint16Array(MAX_CODE_LEN + 2);
  for (let len = 1; len <= MAX_CODE_LEN; len++)
    offs[len + 1] = (offs[len] as number) + (count[len] as number);
  const symbol = new Uint16Array(alphaSize);
  for (let i = 0; i < alphaSize; i++) {
    const len = lengths[i] as number;
    const at = offs[len] as number;
    symbol[at] = i;
    offs[len] = at + 1;
  }
  let maxLen = 0;
  for (let i = 0; i < alphaSize; i++) maxLen = Math.max(maxLen, lengths[i] as number);
  return { count, symbol, maxLen };
}

function decodeSymbol(bits: Bits, t: Table): number {
  let code = 0;
  let first = 0;
  let index = 0;
  for (let len = 1; len <= t.maxLen; len++) {
    code |= bits.bit();
    const count = t.count[len] as number;
    if (code - first < count) return t.symbol[index + code - first] as number;
    index += count;
    first = (first + count) << 1;
    code <<= 1;
  }
  throw new Error("bzip2: a bad Huffman code");
}

/** One block decoded: its bytes, its CRC checked. */
function block(bits: Bits, blockSize: number): { out: Uint8Array; crc: number } {
  const expected = bits.read32();
  if (bits.bit()) throw new Error("bzip2: randomised blocks are not supported");
  const origPtr = bits.read(24);

  // The bytes used: 16 groups of 16.
  const used = bits.read(16);
  const symToByte = new Uint8Array(256);
  let inUse = 0;
  for (let i = 0; i < 16; i++)
    if (used & (0x8000 >> i)) {
      const bitsOf = bits.read(16);
      for (let j = 0; j < 16; j++) if (bitsOf & (0x8000 >> j)) symToByte[inUse++] = i * 16 + j;
    }
  if (!inUse) throw new Error("bzip2: a block without bytes");
  const alphaSize = inUse + 2;

  const groups = bits.read(3);
  if (groups < 2 || groups > MAX_GROUPS) throw new Error("bzip2: a bad table count");
  const selectorCount = bits.read(15);
  if (!selectorCount) throw new Error("bzip2: no selectors");
  const mtfGroups = Array.from({ length: groups }, (_, i) => i);
  const selectors = new Uint8Array(selectorCount);
  for (let i = 0; i < selectorCount; i++) {
    let j = 0;
    while (bits.bit()) if (++j >= groups) throw new Error("bzip2: a bad selector");
    const g = mtfGroups[j] as number;
    mtfGroups.splice(j, 1);
    mtfGroups.unshift(g);
    selectors[i] = g;
  }

  const tables: Table[] = [];
  for (let g = 0; g < groups; g++) {
    const lengths = new Uint8Array(alphaSize);
    let len = bits.read(5);
    for (let s = 0; s < alphaSize; s++) {
      for (;;) {
        if (len < 1 || len > MAX_CODE_LEN) throw new Error("bzip2: a bad code length");
        if (!bits.bit()) break;
        len += bits.bit() ? -1 : 1;
      }
      lengths[s] = len;
    }
    tables.push(table(lengths, alphaSize));
  }

  // Huffman and MTF undone, runs of the first symbol (RUNA, RUNB) expanded.
  const tt = new Uint32Array(blockSize);
  const counts = new Uint32Array(256);
  const mtf = new Uint8Array(256);
  for (let i = 0; i < 256; i++) mtf[i] = i;
  const eob = inUse + 1;
  let n = 0;
  let selector = 0;
  let left = 0;
  let t = tables[0] as Table;
  let run = 0;
  let runWeight = 1;
  for (;;) {
    if (!left) {
      if (selector >= selectorCount) throw new Error("bzip2: selectors run out");
      t = tables[selectors[selector++] as number] as Table;
      left = GROUP_SIZE;
    }
    left--;
    const sym = decodeSymbol(bits, t);
    if (sym <= 1) {
      run += (sym + 1) * runWeight;
      runWeight <<= 1;
      if (run > blockSize) throw new Error("bzip2: a run past the block");
      continue;
    }
    if (run) {
      const b = symToByte[mtf[0] as number] as number;
      if (n + run > blockSize) throw new Error("bzip2: a block too large");
      counts[b] = (counts[b] as number) + run;
      tt.fill(b, n, n + run);
      n += run;
      run = 0;
      runWeight = 1;
    }
    if (sym === eob) break;
    const k = sym - 1;
    const v = mtf[k] as number;
    mtf.copyWithin(1, 0, k);
    mtf[0] = v;
    const b = symToByte[v] as number;
    if (n >= blockSize) throw new Error("bzip2: a block too large");
    counts[b] = (counts[b] as number) + 1;
    tt[n++] = b;
  }
  if (origPtr >= n) throw new Error("bzip2: a bad origin");

  // The Burrows–Wheeler transform undone: each entry's next index in its high bits.
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    const c = counts[i] as number;
    counts[i] = sum;
    sum += c;
  }
  for (let i = 0; i < n; i++) {
    const b = (tt[i] as number) & 0xff;
    const at = counts[b] as number;
    tt[at] = ((tt[at] as number) | (i << 8)) >>> 0;
    counts[b] = at + 1;
  }

  // The first run-length stage undone (four equal bytes, then a count) and the CRC summed.
  let chunk = new Uint8Array(Math.max(1024, n + (n >> 2)));
  let o = 0;
  const put = (b: number) => {
    if (o === chunk.length) {
      const bigger = new Uint8Array(chunk.length * 2);
      bigger.set(chunk);
      chunk = bigger;
    }
    chunk[o++] = b;
  };
  let crc = 0xffffffff;
  let pos = (tt[origPtr] as number) >>> 8;
  let last = -1;
  let same = 0;
  for (let i = 0; i < n; i++) {
    const entry = tt[pos] as number;
    const b = entry & 0xff;
    pos = entry >>> 8;
    if (same === 4) {
      for (let r = 0; r < b; r++) {
        put(last);
        crc = ((crc << 8) ^ (CRC_TABLE[((crc >>> 24) ^ last) & 0xff] as number)) >>> 0;
      }
      same = 0;
      last = -1;
      continue;
    }
    put(b);
    crc = ((crc << 8) ^ (CRC_TABLE[((crc >>> 24) ^ b) & 0xff] as number)) >>> 0;
    if (b === last) same++;
    else {
      last = b;
      same = 1;
    }
  }
  crc = ~crc >>> 0;
  if (crc !== expected) throw new Error("bzip2: a block's CRC does not match");
  return { out: chunk.subarray(0, o), crc };
}

/** The decompressed bytes of a .bz2's contents, a block at a time (the event loop let go between). */
export async function* bunzip2(data: Uint8Array): AsyncGenerator<Uint8Array> {
  const bits = new Bits(data);
  let streams = 0;
  while (bits.more()) {
    if (bits.read(8) !== 0x42 || bits.read(8) !== 0x5a || bits.read(8) !== 0x68) {
      if (streams) return; // Trailing bytes after a stream: as bzip2 itself, ignored.
      throw new Error("bzip2: not a bzip2 file");
    }
    const level = bits.read(8) - 0x30;
    if (level < 1 || level > 9) throw new Error("bzip2: a bad block size");
    const blockSize = level * 100_000;
    let combined = 0;
    for (;;) {
      const hi = bits.read(24);
      const lo = bits.read(24);
      if (hi === END_MAGIC_HI && lo === END_MAGIC_LO) {
        if (bits.read32() !== combined) throw new Error("bzip2: the stream's CRC does not match");
        bits.align();
        break;
      }
      if (hi !== BLOCK_MAGIC_HI || lo !== BLOCK_MAGIC_LO) throw new Error("bzip2: a bad block");
      const { out, crc } = block(bits, blockSize);
      combined = (((combined << 1) | (combined >>> 31)) ^ crc) >>> 0;
      yield out;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    streams++;
  }
}

/** A .bz2 file decompressed into `to` (written as it comes). */
export async function bunzip2File(from: string, to: string) {
  const writer = Bun.file(to).writer();
  try {
    for await (const part of bunzip2(new Uint8Array(await Bun.file(from).arrayBuffer())))
      writer.write(part);
  } finally {
    await writer.end();
  }
}
