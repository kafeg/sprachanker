// The phone's DataFs (src/phone-fs.ts) over a native side played here by Node over a folder, as
// Native.kt answers (bytes as Latin-1, failures as "CODE message"), and the files' scheme answering
// `?part=`: what the shared code sees of it — folders kept and asked again after a change, files written
// in parts, read in parts, summed.
import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { crc32 } from "node:zlib";
import { chunksOf, readAll } from "@sprachanker/course-kit";

const root = mkdtempSync(join(tmpdir(), "phone-fs-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const latin1 = (b: Uint8Array) => Buffer.from(b).toString("latin1");
const attempt = (f: () => void) => {
  try {
    f();
    return "";
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return `${err.code ?? "EIO"} ${err.message}`;
  }
};
const sinks = new Map<number, { file: string; parts: Buffer[] }>();
let asked = 0;
const bridge = {
  root: () => root,
  stat(p: string) {
    asked++;
    const s = statSync(p, { throwIfNoEntry: false });
    return s ? `${s.isDirectory() ? 0 : s.size} ${s.mtimeMs} ${s.isDirectory() ? "d" : "f"}` : "";
  },
  dir(p: string) {
    asked++;
    if (!statSync(p, { throwIfNoEntry: false })?.isDirectory()) return "";
    return readdirSync(p)
      .map((n) => {
        const s = statSync(join(p, n));
        return `${n}\t${s.isDirectory() ? 0 : s.size}\t${s.mtimeMs}\t${s.isDirectory() ? "d" : "f"}\n`;
      })
      .join("");
  },
  readText: (p: string) =>
    statSync(p, { throwIfNoEntry: false })?.isFile() ? readFileSync(p, "utf8") : null,
  readBytes: (p: string, start: number, length: number) =>
    statSync(p, { throwIfNoEntry: false })?.isFile()
      ? latin1(readFileSync(p).subarray(start, start + length))
      : null,
  writeText: (p: string, t: string) =>
    attempt(() => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, t);
    }),
  writeBytes: (p: string, d: string) =>
    attempt(() => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, Buffer.from(d, "latin1"));
    }),
  mkdir: (p: string) => attempt(() => mkdirSync(p, { recursive: true })),
  rename: (a: string, b: string) => attempt(() => renameSync(a, b)),
  remove: (p: string) => attempt(() => rmSync(p, { recursive: true, force: true })),
  removeDir: (p: string) => attempt(() => rmdirSync(p)),
  link: (a: string, b: string) => attempt(() => linkSync(a, b)),
  copy: (a: string, b: string) => attempt(() => copyFileSync(a, b)),
  touch: (p: string) => attempt(() => utimesSync(p, new Date(), new Date())),
  disk: () => "1000 2000",
  openWrite(p: string) {
    mkdirSync(dirname(p), { recursive: true });
    const id = sinks.size + 1;
    sinks.set(id, { file: p, parts: [] });
    return String(id);
  },
  append(h: number, d: string) {
    sinks.get(h)?.parts.push(Buffer.from(d, "latin1"));
    return "";
  },
  closeWrite(h: number) {
    const s = sinks.get(h);
    if (!s) return "!EBADF";
    const all = Buffer.concat(s.parts);
    writeFileSync(s.file, all);
    sinks.delete(h);
    return `${createHash("sha256").update(all).digest("hex")} ${all.length}`;
  },
  abortWrite: (h: number) => void sinks.delete(h),
  sumsNow(p: string) {
    const b = readFileSync(p);
    return JSON.stringify({
      sha256: createHash("sha256").update(b).digest("hex"),
      size: b.length,
      crc32: crc32(b),
    });
  },
};
(globalThis as { sprachankerNativeBridge?: unknown }).sprachankerNativeBridge = bridge;
(globalThis as { sprachankerFiles?: string }).sprachankerFiles = "http://files.test";
(globalThis as { location?: unknown }).location = { protocol: "http:" };

/** The scheme: a part of a file by `?part=a-b`. */
const net = (async (url: string) => {
  const u = new URL(url);
  const file = join(root, ...u.pathname.split("/").slice(1).map(decodeURIComponent));
  const [a, b] = (u.searchParams.get("part") ?? "").split("-").map(Number) as [number, number];
  return new Response(readFileSync(file).subarray(a, b + 1));
}) as unknown as typeof fetch;

const { phoneFs } = await import("../src/phone-fs.ts");

test("files written, listed from what is kept, read in parts and summed", async () => {
  const fs = phoneFs(root, net);
  const p = (rel: string) => `${root}/${rel}`;
  fs.writeFile(p("a/b.txt"), "hallo");
  expect(fs.readText(p("a/b.txt"))).toBe("hallo");
  expect(fs.list(p("a"))).toEqual(["b.txt"]);
  const before = asked;
  for (let i = 0; i < 100; i++) fs.stat(p("a/b.txt"));
  // Kept: the folder was asked once.
  expect(asked - before).toBe(0);
  const big = new Uint8Array(5 << 20).map((_, i) => (i * 7) & 0xff);
  const written = await fs.write(p("x/big.bin"), chunksOf(big));
  expect(written?.size).toBe(big.length);
  expect(fs.stat(p("x/big.bin"))?.size).toBe(big.length);
  expect(Buffer.from(await readAll(fs, p("x/big.bin"))).equals(Buffer.from(big))).toBe(true);
  // A part of it, past the first read's end.
  const parts: Uint8Array[] = [];
  for await (const c of fs.stream(p("x/big.bin"), (4 << 20) + 3, (4 << 20) + 9)) parts.push(c);
  expect([...(parts[0] ?? [])]).toEqual([...big.subarray((4 << 20) + 3, (4 << 20) + 10)]);
  expect((await fs.sums(p("a/b.txt"))).size).toBe(5);
  fs.rename(p("a"), p("c"));
  expect(fs.stat(p("a"))).toBeUndefined();
  expect(fs.readText(p("c/b.txt"))).toBe("hallo");
  let code = "";
  try {
    fs.removeDir(p("c"));
  } catch (e) {
    code = (e as { code: string }).code;
  }
  expect(code).toBe("ENOTEMPTY");
  fs.remove(p("c"));
  expect(fs.list(root).sort()).toEqual(["x"]);
});

test("a file written into a large folder asks for its own entry, never the folder again", async () => {
  const fs = phoneFs(root, net);
  const dir = `${root}/many`;
  for (let i = 0; i < 200; i++) fs.writeFile(`${dir}/${i}.mp3`, "x");
  expect(fs.list(dir).length).toBe(200);
  const before = asked;
  for (let i = 200; i < 300; i++) {
    await fs.write(`${dir}/${i}.mp3`, chunksOf("yy"));
    expect(fs.stat(`${dir}/${i}.mp3`)?.size).toBe(2);
  }
  // Each write: its own entry asked (opened, then closed), the folder kept.
  expect(asked - before).toBeLessThanOrEqual(200);
  expect(fs.list(dir).length).toBe(300);
  fs.remove(`${dir}/0.mp3`);
  expect(fs.stat(`${dir}/0.mp3`)).toBeUndefined();
  expect(fs.list(dir).length).toBe(299);
});

test("a folder known as not there is asked again once a file is written into it", async () => {
  const fs = phoneFs(root, net);
  const file = `${root}/later/deep/page.html`;
  expect(fs.stat(file)).toBeUndefined();
  expect(fs.readText(file)).toBeUndefined();
  await fs.write(`${file}.tmp`, chunksOf("<p>"));
  fs.rename(`${file}.tmp`, file);
  expect(fs.readText(file)).toBe("<p>");
  expect(fs.list(`${root}/later`)).toEqual(["deep"]);
});

test("a file made several folders under one listed, those between never asked, shows in the listed one", () => {
  const fs = phoneFs(root, net);
  expect(fs.list(root)).not.toContain("fresh");
  fs.writeFile(`${root}/fresh/a/b/file.txt`, "x");
  expect(fs.list(root)).toContain("fresh");
  expect(fs.readText(`${root}/fresh/a/b/file.txt`)).toBe("x");
});

test("a file not there is not streamed as an empty one", async () => {
  const fs = phoneFs(root, net);
  await expect(readAll(fs, `${root}/nowhere.bin`)).rejects.toMatchObject({ code: "ENOENT" });
});

test("a name in another case is the file there: the phone's storage does not tell case apart", () => {
  const fs = phoneFs(root, net);
  fs.writeFile(`${root}/cased/foo.png`, "ours");
  expect(fs.stat(`${root}/cased/FOO.png`)?.size).toBe(4);
  // Known again after a change in the folder.
  fs.writeFile(`${root}/cased/bar.png`, "x");
  expect(fs.stat(`${root}/cased/Bar.PNG`)?.size).toBe(1);
  expect(fs.stat(`${root}/cased/baz.png`)).toBeUndefined();
});
