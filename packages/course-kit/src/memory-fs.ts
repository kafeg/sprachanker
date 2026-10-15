// A DataFs kept in memory: what tests run the shared code over to show it reaches files only through
// the interface (no Node), and how much free room a disk has, set by the test.
import { type DataFs, dirName, fsError, joinPath } from "./data-fs.ts";
import { crc32, Sha256 } from "./hash.ts";

interface Node {
  dir: boolean;
  data: Uint8Array;
  mtimeMs: number;
}

export function memoryFs(options: { free?: number; size?: number; now?: () => number } = {}) {
  const nodes = new Map<string, Node>([["/", { dir: true, data: new Uint8Array(), mtimeMs: 0 }]]);
  const now = options.now ?? Date.now;
  const norm = (path: string) => joinPath("/", path);
  const parentOf = (path: string) => nodes.get(dirName(path));
  const need = (path: string) => {
    const node = nodes.get(norm(path));
    if (!node) throw fsError("ENOENT", path);
    return node;
  };
  const mkdirs = (path: string) => {
    const p = norm(path);
    if (nodes.get(p)?.dir) return;
    if (nodes.has(p)) throw fsError("EEXIST", path);
    if (p !== "/") mkdirs(dirName(p));
    nodes.set(p, { dir: true, data: new Uint8Array(), mtimeMs: now() });
  };
  const put = (path: string, data: Uint8Array) => {
    const p = norm(path);
    const parent = parentOf(p);
    if (!parent?.dir) throw fsError("ENOENT", path);
    if (nodes.get(p)?.dir) throw fsError("EISDIR", path);
    nodes.set(p, { dir: false, data, mtimeMs: now() });
  };
  const under = (p: string) => [...nodes.keys()].filter((k) => k === p || k.startsWith(`${p}/`));
  const bytesOf = (data: string | Uint8Array) =>
    typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);

  const fs: DataFs & { free: number; files(): string[] } = {
    free: options.free ?? 1024 ** 4,
    files: () => [...nodes].filter(([, n]) => !n.dir).map(([k]) => k),
    stat(path) {
      const node = nodes.get(norm(path));
      return node && { size: node.data.length, mtimeMs: node.mtimeMs, dir: node.dir };
    },
    list(path) {
      const p = norm(path);
      if (!nodes.get(p)?.dir) return [];
      const prefix = p === "/" ? "/" : `${p}/`;
      return [...nodes.keys()]
        .filter((k) => k !== p && k.startsWith(prefix) && !k.slice(prefix.length).includes("/"))
        .map((k) => k.slice(prefix.length));
    },
    readText(path) {
      const node = nodes.get(norm(path));
      return node && !node.dir ? new TextDecoder().decode(node.data) : undefined;
    },
    readBytes(path, start = 0, length) {
      const node = nodes.get(norm(path));
      if (!node || node.dir) return undefined;
      return node.data.slice(start, length === undefined ? undefined : start + length);
    },
    writeFile(path, data) {
      mkdirs(dirName(norm(path)));
      put(path, bytesOf(data));
    },
    mkdir: mkdirs,
    rename(from, to) {
      const f = norm(from);
      const t = norm(to);
      need(f);
      if (!parentOf(t)?.dir) throw fsError("ENOENT", to);
      if (nodes.get(t)?.dir && fs.list(t).length) throw fsError("ENOTEMPTY", to);
      for (const k of under(t)) nodes.delete(k);
      for (const k of under(f)) {
        nodes.set(t + k.slice(f.length), nodes.get(k) as Node);
        nodes.delete(k);
      }
    },
    remove(path) {
      for (const k of under(norm(path))) nodes.delete(k);
    },
    removeDir(path) {
      const p = norm(path);
      if (!need(p).dir) throw fsError("ENOTDIR", path);
      if (fs.list(p).length) throw fsError("ENOTEMPTY", path);
      nodes.delete(p);
    },
    link(from, to) {
      const node = need(from);
      if (nodes.has(norm(to))) throw fsError("EEXIST", to);
      if (!parentOf(norm(to))?.dir) throw fsError("ENOENT", to);
      nodes.set(norm(to), node);
    },
    copy(from, to) {
      const node = need(from);
      if (nodes.has(norm(to))) throw fsError("EEXIST", to);
      put(to, node.data.slice());
    },
    touch(path) {
      need(path).mtimeMs = now();
    },
    disk: () => ({ free: fs.free, size: options.size ?? 1024 ** 4 }),
    async *stream(path, start = 0, end) {
      const node = need(path);
      yield node.data.slice(start, end === undefined ? undefined : end + 1);
    },
    async write(path, chunks, { max = Number.POSITIVE_INFINITY } = {}) {
      mkdirs(dirName(norm(path)));
      const parts: Uint8Array[] = [];
      const hash = new Sha256();
      let size = 0;
      put(path, new Uint8Array());
      for await (const chunk of chunks) {
        size += chunk.byteLength;
        if (size > max) return undefined;
        hash.update(chunk);
        parts.push(chunk.slice());
        const data = new Uint8Array(size);
        let at = 0;
        for (const part of parts) {
          data.set(part, at);
          at += part.length;
        }
        put(path, data);
      }
      return { sha256: hash.hex(), size };
    },
    async sums(path) {
      const { data } = need(path);
      return { sha256: new Sha256().update(data).hex(), size: data.length, crc32: crc32(data) };
    },
  };
  return fs;
}
export type MemoryFs = ReturnType<typeof memoryFs>;
