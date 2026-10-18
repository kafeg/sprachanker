// bzip2 undone in TypeScript (runtime/bzip2.ts) against the bzip2 program's own output: runs long
// and short, random bytes, several blocks, concatenated streams; a damaged file refused.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bunzip2, bunzip2File } from "../src/runtime/bzip2.ts";

/** `bytes` compressed by the bzip2 program (macOS and Linux have it), at a block size of `level`. */
function compress(bytes: Uint8Array, level = 9) {
  const run = spawnSync("bzip2", [`-${level}`, "-c"], { input: bytes, maxBuffer: 1 << 28 });
  if (run.status !== 0) throw new Error(`bzip2: ${run.stderr}`);
  return new Uint8Array(run.stdout);
}

async function undo(bz: Uint8Array) {
  const parts: Uint8Array[] = [];
  for await (const part of bunzip2(bz)) parts.push(part);
  return new Uint8Array(Buffer.concat(parts));
}

/** A pseudo-random stream (the same every run). */
function noise(n: number, seed = 1) {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

test("what the bzip2 program made comes back byte for byte: text, long runs, noise, several blocks", async () => {
  const text = new TextEncoder().encode("Ich lerne jeden Tag ein bisschen Deutsch. ".repeat(4000));
  const runs = new Uint8Array(300_000);
  runs.fill(7, 1000, 200_000); // a run far past the 4 + 255 the first stage holds at once
  for (let i = 200_000; i < runs.length; i += 5) runs[i] = i % 3; // short runs of every length
  const cases = [
    new Uint8Array([42]),
    text,
    runs,
    noise(250_000),
    new Uint8Array(Buffer.concat([noise(150_000, 7), text, runs])), // more than one block at -1
  ];
  for (const bytes of cases)
    for (const level of [1, 9]) expect(await undo(compress(bytes, level))).toEqual(bytes);
});

test("concatenated streams are read one after the other (as pbzip2 writes them)", async () => {
  const a = new TextEncoder().encode("first stream ".repeat(100));
  const b = noise(5000, 3);
  const both = new Uint8Array(Buffer.concat([compress(a), compress(b)]));
  expect(await undo(both)).toEqual(new Uint8Array(Buffer.concat([a, b])));
});

test("a damaged file is refused, never taken for whole: a changed byte, a cut, not bzip2", async () => {
  const bz = compress(noise(100_000, 5));
  const changed = bz.slice();
  const at = Math.floor(bz.length / 2);
  changed[at] = (changed[at] as number) ^ 0x40;
  await expect(undo(changed)).rejects.toThrow(/bzip2/);
  await expect(undo(bz.subarray(0, bz.length - 10))).rejects.toThrow(/bzip2/);
  await expect(undo(new TextEncoder().encode("not bzip2 at all"))).rejects.toThrow(/not a bzip2/);
});

test("more than allowed is refused; a stopped one stops between blocks", async () => {
  const bz = compress(new Uint8Array(3_000_000), 1);
  await expect(undo2(bz, { maxBytes: 1_000_000 })).rejects.toThrow(/larger than allowed/);
  const stop = new AbortController();
  stop.abort();
  await expect(undo2(bz, { signal: stop.signal })).rejects.toThrow();
});

async function undo2(bz: Uint8Array, options: Parameters<typeof bunzip2>[1]) {
  for await (const _ of bunzip2(bz, options));
}

test("a file undone into another, written as it comes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sa-bzip2-"));
  const bytes = noise(400_000, 11);
  writeFileSync(join(dir, "a.bz2"), compress(bytes));
  await bunzip2File(join(dir, "a.bz2"), join(dir, "a"));
  expect(new Uint8Array(readFileSync(join(dir, "a")))).toEqual(bytes);
});
