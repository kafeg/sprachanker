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
/** A file this small is read and summed by the bridge at once: a request's or an answer's round trip
 *  takes longer than the reading (a deck's thousands of sounds). */
const SMALL = 512 << 10;

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
  const info = (path: string): FileInfo | undefined => {
    const s = b.stat(path);
    if (!s) return undefined;
    const [size, mtime, kind] = s.split(" ");
    return { size: Number(size), mtimeMs: Number(mtime), dir: kind === "d" };
  };
  /** A path changed here: its own entry asked again in the folder kept (not the whole folder: a
   *  deck's has thousands), the folders above it that did not know it, and what was kept under it
   *  forgotten. */
  const changed = (...paths: string[]) => {
    for (const path of paths) {
      for (const dir of [...known.keys()])
        if (dir === path || dir.startsWith(`${path}/`)) known.delete(dir);
      for (let p = path; p.startsWith(`${root}/`); p = dirName(p)) {
        const dir = dirName(p);
        // A folder not asked about yet: nothing kept of it, but one above may be (a path made
        // several folders deep at once).
        if (!known.has(dir)) continue;
        const parent = known.get(dir);
        // A folder known as not there may be there now (made for this path): asked again when next
        // needed, and so may the folders above it.
        if (!parent) {
          known.delete(dir);
          continue;
        }
        const name = p.slice(p.lastIndexOf("/") + 1);
        const had = parent.has(name);
        const now = info(p);
        if (now) parent.set(name, now);
        else parent.delete(name);
        folded.delete(parent);
        // A folder above it known already: nothing more above changed.
        if (p !== path && had) break;
      }
    }
  };
  /** A change made: what it changed noted, then its failure thrown, if it failed. */
  const after = (answer: string, ...paths: string[]) => {
    changed(...paths);
    check(answer);
  };
  /** A folder's entries by their names folded: the phone's shared storage does not tell case apart,
   *  so a name in another case is that file (as on a Mac's disk). */
  const folded = new WeakMap<Map<string, FileInfo>, Map<string, FileInfo>>();
  const fold = (name: string) => name.normalize("NFC").toLowerCase();
  const at = (path: string) => {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const dir = entries(dirName(path));
    const exact = dir?.get(name);
    if (exact || !dir) return exact;
    let byFold = folded.get(dir);
    if (!byFold) {
      byFold = new Map([...dir].map(([n, info]) => [fold(n), info]));
      folded.set(dir, byFold);
    }
    return byFold.get(fold(name));
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
    writeFile: (path, data) =>
      after(
        typeof data === "string" ? b.writeText(path, data) : b.writeBytes(path, latin1(data)),
        path,
      ),
    mkdir: (path) => after(b.mkdir(path), path),
    rename: (from, to) => after(b.rename(from, to), from, to),
    remove: (path) => after(b.remove(path), path),
    removeDir: (path) => after(b.removeDir(path), path),
    link: (from, to) => after(b.link(from, to), to),
    copy: (from, to) => after(b.copy(from, to), to),
    touch: (path) => after(b.touch(path), path),
    disk(path) {
      const d = b.disk(path);
      if (!d) return null;
      const [free, size] = d.split(" ").map(Number) as [number, number];
      return { free, size };
    },
    async *stream(path, start = 0, end) {
      const info = fs.stat(path);
      if (!info || info.dir) throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
      const last = end ?? info.size - 1;
      if (last - start < SMALL) {
        if (last < start) return;
        const got = b.readBytes(path, start, last - start + 1);
        if (got == null) throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
        yield fromLatin1(got);
        return;
      }
      for (let from = start; from <= last; from += READ_PART) {
        const to = Math.min(last, from + READ_PART - 1);
        // A part by the scheme's own query: a Range header Android's WebView applies again itself.
        const res = await net(`${url(path)}?part=${from}-${to}`);
        if (!res.ok) throw Object.assign(new Error(`${path}: ${res.status}`), { code: "ENOENT" });
        yield new Uint8Array(await res.arrayBuffer());
      }
    },
    async write(path, chunks, { max = Number.POSITIVE_INFINITY, sync = false } = {}) {
      const opened = b.openWrite(path);
      changed(path);
      if (opened.startsWith("!")) check(opened.slice(1));
      const handle = Number(opened);
      let size = 0;
      try {
        for await (const chunk of chunks) {
          size += chunk.byteLength;
          if (size > max) {
            b.abortWrite(handle);
            changed(path);
            return undefined;
          }
          for (let from = 0; from < chunk.byteLength; from += WRITE_PART)
            check(b.append(handle, latin1(chunk.subarray(from, from + WRITE_PART))));
        }
      } catch (error) {
        b.abortWrite(handle);
        changed(path);
        throw error;
      }
      const closed = b.closeWrite(handle, sync);
      changed(path);
      if (closed.startsWith("!")) check(closed.slice(1));
      const [sha256, bytes] = closed.split(" ");
      return { sha256: sha256 as string, size: Number(bytes) };
    },
    async sums(path) {
      const small = (fs.stat(path)?.size ?? 0) < SMALL;
      const got: FileSums | { error: string } = small
        ? JSON.parse(b.sumsNow(path))
        : await once((id) => b.sums(id, path));
      if ("error" in got) check(got.error);
      return got as FileSums;
    },
  };
  return fs;
}
