import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openKeyMap } from "../src/key-map.ts";

test("numbers by place the first time, then by source id, kept across normalisations", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sprachanker-keys-"));
  const first = await openKeyMap(dir);
  expect(["a", "b", "c"].map((id, i) => first.number("u1", id, i + 1))).toEqual([1, 2, 3]);
  await first.save();
  const again = await openKeyMap(dir);
  // "x" inserted second, "b" dropped: a and c keep theirs; 2 stays b's, so x takes the next free.
  expect(["a", "x", "c"].map((id, i) => again.number("u1", id, i + 1))).toEqual([1, 4, 3]);
  // Another scope numbers on its own.
  expect(again.number("u2", "a", 1)).toBe(1);
  await again.save();
  expect(JSON.parse(readFileSync(join(dir, "keys.json"), "utf8"))).toEqual({
    u1: { a: 1, b: 2, c: 3, x: 4 },
    u2: { a: 1 },
  });
});

test("a key map that does not read stops the normaliser instead of numbering afresh", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sprachanker-keys-"));
  writeFileSync(join(dir, "keys.json"), "{ cut short");
  await expect(openKeyMap(dir)).rejects.toThrow();
  writeFileSync(join(dir, "keys.json"), JSON.stringify({ u1: { a: "one" } }));
  await expect(openKeyMap(dir)).rejects.toThrow();
});
