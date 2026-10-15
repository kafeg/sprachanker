// The phone's files as course-kit's DataFs, the shared code's file system (Android): small things
// answered at once by the native bridge, bytes read in large parts from the native scheme (binary),
// written in parts through the bridge. A folder's entries are asked once and kept (a call to the
// bridge takes about a millisecond; the library asks for hundreds of files), each change made here
// noted: nothing else writes into the data root while the app runs.
import {
  type DataFs,
  dirName,
  type FileInfo,
  type FileSums,
} from "@sprachanker/course-kit/data-fs";
import { check, fromLatin1, latin1, needBridge, once } from "./bridge.ts";
import { FILES } from "./native.ts";

/** Bytes read from the scheme at once. */
const READ_PART = 4 << 20;
/** Bytes sent to the bridge at once. */
const WRITE_PART = 1 << 20;

/** The phone's DataFs over its data root (`root`: its absolute path), reading through `net` (the
 *  page's own fetch). */
export function phoneFs(root: string, net: typeof fetch): DataFs {
  const b = needBridge();
  const rel = (path: string) =>
    path === root ? "" : path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  const url = (path: string) =>
    `${FILES}/${rel(path).split("/").map(encodeURIComponent).join("/")}`;

  /** Folders' entries as asked of the bridge (undefined: no such folder). */
  const known = new Map<string, Map<string, FileInfo> | undefined>();
  const entries = (dir: string) => {
    if (known.has(dir)) return known.get(dir);
    const listed = b.dir(dir);
    let found: Map<string, FileInfo> | undefined;
    if (listed || b.stat(dir).endsWith(" d")) {
      found = new Map();
      for (const line of listed.split("\n")) {
        if (!line) continue;
        const [name, size, mtime, kind] = line.split("\t") as [string, string, string, string];
        found.set(name, { size: Number(size), mtimeMs: Number(mtime), dir: kind === "d" });
      }
    }
    known.set(dir, found);
    return found;
  };
  /** A path changed here: its folder and all under it asked again. */
  const changed = (...paths: string[]) => {
    for (const path of paths) {
      known.delete(dirName(path));
      for (const dir of [...known.keys()])
        if (dir === path || dir.startsWith(`${path}/`)) known.delete(dir);
    }
  };
  const at = (path: string) => {
    const name = path.slice(path.lastIndexOf("/") + 1);
    return entries(dirName(path))?.get(name);
  };

  const fs: DataFs = {
    stat: (path) => (path === root ? { size: 0, mtimeMs: 0, dir: true } : at(path)),
    list: (path) => [...(entries(path)?.keys() ?? [])],
    readText: (path) => (at(path) ? (b.readText(path) ?? undefined) : undefined),
    readBytes(path, start = 0, length) {
      const info = at(path);
      if (!info || info.dir) return undefined;
      const got = b.readBytes(path, start, length ?? Math.max(0, info.size - start));
      return got == null ? undefined : fromLatin1(got);
    },
    writeFile(path, data) {
      changed(path);
      check(typeof data === "string" ? b.writeText(path, data) : b.writeBytes(path, latin1(data)));
    },
    mkdir(path) {
      changed(path);
      check(b.mkdir(path));
    },
    rename(from, to) {
      changed(from, to);
      check(b.rename(from, to));
    },
    remove(path) {
      changed(path);
      check(b.remove(path));
    },
    removeDir(path) {
      changed(path);
      check(b.removeDir(path));
    },
    link(from, to) {
      changed(to);
      check(b.link(from, to));
    },
    copy(from, to) {
      changed(to);
      check(b.copy(from, to));
    },
    touch(path) {
      changed(path);
      check(b.touch(path));
    },
    disk(path) {
      const d = b.disk(path);
      if (!d) return null;
      const [free, size] = d.split(" ").map(Number) as [number, number];
      return { free, size };
    },
    async *stream(path, start = 0, end) {
      const last = end ?? (fs.stat(path)?.size ?? 0) - 1;
      for (let from = start; from <= last; from += READ_PART) {
        const to = Math.min(last, from + READ_PART - 1);
        // A part by the scheme's own query: a Range header Android's WebView applies again itself.
        const res = await net(`${url(path)}?part=${from}-${to}`);
        if (!res.ok) throw Object.assign(new Error(`${path}: ${res.status}`), { code: "ENOENT" });
        yield new Uint8Array(await res.arrayBuffer());
      }
    },
    async write(path, chunks, { max = Number.POSITIVE_INFINITY, sync = false } = {}) {
      changed(path);
      const opened = b.openWrite(path);
      if (opened.startsWith("!")) check(opened.slice(1));
      const handle = Number(opened);
      let size = 0;
      try {
        for await (const chunk of chunks) {
          size += chunk.byteLength;
          if (size > max) {
            b.abortWrite(handle);
            return undefined;
          }
          for (let from = 0; from < chunk.byteLength; from += WRITE_PART)
            check(b.append(handle, latin1(chunk.subarray(from, from + WRITE_PART))));
        }
      } catch (error) {
        b.abortWrite(handle);
        throw error;
      } finally {
        changed(path);
      }
      const closed = b.closeWrite(handle, sync);
      if (closed.startsWith("!")) check(closed.slice(1));
      const [sha256, bytes] = closed.split(" ");
      return { sha256: sha256 as string, size: Number(bytes) };
    },
    async sums(path) {
      const got = await once<FileSums | { error: string }>((id) => b.sums(id, path));
      if ("error" in got) check(got.error);
      return got as FileSums;
    },
  };
  return fs;
}
