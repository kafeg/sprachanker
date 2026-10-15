import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 as nodeCrc32 } from "node:zlib";
import {
  baseName,
  chunksOf,
  type DataFs,
  dirName,
  errorCode,
  extName,
  joinPath,
  listFiles,
  readAll,
} from "../src/data-fs.ts";
import { crc32, Sha256, sha256Hex } from "../src/hash.ts";
import { memoryFs } from "../src/memory-fs.ts";
import { nodeFs } from "../src/node-fs.ts";

describe("hash", () => {
  test("sha256 and crc32 match Node's for many lengths, fed whole or in parts", () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 70_000]) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 31 + n) & 0xff);
      expect(sha256Hex(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
      const parts = new Sha256();
      for (let at = 0; at < n; at += 37) parts.update(bytes.subarray(at, at + 37));
      expect(parts.hex()).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(crc32(bytes)).toBe(nodeCrc32(bytes));
      expect(crc32(bytes.subarray(n >> 1), crc32(bytes.subarray(0, n >> 1)))).toBe(
        nodeCrc32(bytes),
      );
    }
    expect(sha256Hex("Grüße")).toBe(createHash("sha256").update("Grüße").digest("hex"));
  });
});

describe("paths", () => {
  test("joined, split", () => {
    expect(joinPath("/a/b", "../c", "./d")).toBe("/a/c/d");
    expect(dirName("/a/b/c.json")).toBe("/a/b");
    expect(dirName("/a")).toBe("/");
    expect(baseName("/a/b/c.json")).toBe("c.json");
    expect(extName("/a/b.c/d.MP4")).toBe(".MP4");
    expect(extName("/a/.hidden")).toBe("");
  });
});

/** The same behaviour from every implementation. */
function contract(name: string, make: () => { fs: DataFs; root: string; done(): void }) {
  describe(name, () => {
    test("files written, read, listed, renamed, linked, removed", async () => {
      const { fs, root, done } = make();
      try {
        const p = (rel: string) => joinPath(root, rel);
        expect(fs.stat(p("a"))).toBeUndefined();
        expect(fs.list(p("a"))).toEqual([]);
        fs.writeFile(p("a/b/c.txt"), "hallo");
        expect(fs.readText(p("a/b/c.txt"))).toBe("hallo");
        expect(fs.stat(p("a/b"))?.dir).toBe(true);
        expect(fs.stat(p("a/b/c.txt"))).toMatchObject({ size: 5, dir: false });
        expect(fs.readBytes(p("a/b/c.txt"), 1, 3)).toEqual(new TextEncoder().encode("all"));
        expect(fs.readBytes(p("a/b/c.txt"), 3, 10)).toEqual(new TextEncoder().encode("lo"));
        expect(fs.list(p("a/b"))).toEqual(["c.txt"]);
        const written = await fs.write(p("x/y.bin"), chunksOf(new Uint8Array([1, 2, 3])));
        expect(written).toEqual({
          size: 3,
          sha256: createHash("sha256")
            .update(new Uint8Array([1, 2, 3]))
            .digest("hex"),
        });
        expect(await fs.write(p("x/z.bin"), chunksOf("toolong"), { max: 3 })).toBeUndefined();
        expect(await readAll(fs, p("x/y.bin"))).toEqual(new Uint8Array([1, 2, 3]));
        const part: Uint8Array[] = [];
        for await (const c of fs.stream(p("a/b/c.txt"), 1, 2)) part.push(c);
        expect(new TextDecoder().decode(part[0])).toBe("al");
        expect(await fs.sums(p("x/y.bin"))).toMatchObject({
          size: 3,
          crc32: nodeCrc32(new Uint8Array([1, 2, 3])),
        });
        fs.link(p("a/b/c.txt"), p("a/linked.txt"));
        expect(fs.readText(p("a/linked.txt"))).toBe("hallo");
        let code = "";
        try {
          fs.link(p("a/b/c.txt"), p("a/linked.txt"));
        } catch (e) {
          code = errorCode(e);
        }
        expect(code).toBe("EEXIST");
        fs.copy(p("a/b/c.txt"), p("a/copied.txt"));
        expect(fs.readText(p("a/copied.txt"))).toBe("hallo");
        fs.rename(p("a/b"), p("a/d"));
        expect(fs.readText(p("a/d/c.txt"))).toBe("hallo");
        expect(listFiles(fs, p("a")).sort()).toEqual(["copied.txt", "d/c.txt", "linked.txt"]);
        fs.mkdir(p("e/f"));
        try {
          fs.removeDir(p("e"));
        } catch (e) {
          code = errorCode(e);
        }
        expect(code).toBe("ENOTEMPTY");
        fs.removeDir(p("e/f"));
        fs.remove(p("a"));
        fs.remove(p("nothing"));
        expect(fs.stat(p("a"))).toBeUndefined();
        expect(fs.disk(root)?.free).toBeGreaterThan(0);
      } finally {
        done();
      }
    });
  });
}

contract("node", () => {
  const root = mkdtempSync(join(tmpdir(), "data-fs-"));
  return { fs: nodeFs, root, done: () => rmSync(root, { recursive: true, force: true }) };
});
contract("memory", () => ({ fs: memoryFs(), root: "/data", done() {} }));
