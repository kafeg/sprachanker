// The data folder through Node's file system: DataFs (data-fs.ts) as the desktop runs it — the server,
// the command line, the tests.
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  copyFileSync,
  createReadStream,
  fstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmdirSync,
  rmSync,
  statfsSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import { crc32 } from "node:zlib";
import type { DataFs } from "./data-fs.ts";

export const nodeFs: DataFs = {
  stat(path) {
    const s = statSync(path, { throwIfNoEntry: false });
    return s && { size: s.size, mtimeMs: s.mtimeMs, dir: s.isDirectory() };
  },
  list: (path) =>
    statSync(path, { throwIfNoEntry: false })?.isDirectory() ? readdirSync(path) : [],
  readText: (path) =>
    statSync(path, { throwIfNoEntry: false })?.isFile() ? readFileSync(path, "utf8") : undefined,
  readBytes(path, start, length) {
    if (!statSync(path, { throwIfNoEntry: false })?.isFile()) return undefined;
    if (start === undefined) {
      const bytes = readFileSync(path);
      return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    const fd = openSync(path, "r");
    try {
      const size = fstatSync(fd).size;
      const n = Math.max(0, Math.min(length ?? size, size - start));
      const out = new Uint8Array(n);
      let at = 0;
      while (at < n) {
        const read = readSync(fd, out, at, n - at, start + at);
        if (!read) break;
        at += read;
      }
      return out.subarray(0, at);
    } finally {
      closeSync(fd);
    }
  },
  writeFile(path, data) {
    mkdirSync(dirname(path), { recursive: true });
    const part = `${path}.part`;
    writeFileSync(part, data);
    renameSync(part, path);
  },
  mkdir: (path) => void mkdirSync(path, { recursive: true }),
  rename: renameSync,
  remove: (path) => rmSync(path, { recursive: true, force: true }),
  removeDir: rmdirSync,
  link: linkSync,
  copy: (from, to) => copyFileSync(from, to, constants.COPYFILE_EXCL),
  touch(path) {
    const now = new Date();
    utimesSync(path, now, now);
  },
  disk(path) {
    try {
      const disk = statfsSync(path);
      return { free: disk.bavail * disk.bsize, size: disk.blocks * disk.bsize };
    } catch {
      return null;
    }
  },
  stream: (path, start, end) =>
    (start !== undefined && end !== undefined && end < start
      ? []
      : createReadStream(path, { start, end })) as AsyncIterable<Uint8Array>,
  async write(path, chunks, { max = Number.POSITIVE_INFINITY, sync = false, mode = 0o666 } = {}) {
    await mkdir(dirname(path), { recursive: true });
    const handle = await open(path, "w", mode);
    const hash = createHash("sha256");
    let size = 0;
    try {
      for await (const chunk of chunks) {
        size += chunk.byteLength;
        if (size > max) return undefined;
        hash.update(chunk);
        await handle.write(chunk);
      }
      if (sync) await handle.sync();
    } finally {
      await handle.close();
    }
    return { sha256: hash.digest("hex"), size };
  },
  async sums(path) {
    const hash = createHash("sha256");
    let size = 0;
    let crc = 0;
    for await (const chunk of createReadStream(path)) {
      hash.update(chunk as Buffer);
      crc = crc32(chunk as Buffer, crc);
      size += (chunk as Buffer).length;
    }
    return { sha256: hash.digest("hex"), size, crc32: crc };
  },
};
