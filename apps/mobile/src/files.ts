// The app's files as the server's code sees them: listed once at the start into a tree kept here
// (the library's questions — is a file there, what is in a folder — are synchronous), read through
// the native side, written and removed through it with the tree kept up to date (iOS); on Android the
// same over the shared code's DataFs (`filesOver`).
import { type DataFs, isFile, libraryFs, readAll } from "@sprachanker/course-kit";
import type { LibraryFs } from "@sprachanker/course-kit/library-over";
import { native } from "./native.ts";

interface Node {
  dirs: Set<string>;
  files: Map<string, { size: number; mtimeMs: number }>;
}

export async function openFiles() {
  const root = await native.root();
  const tree = new Map<string, Node>();
  const node = (dir: string) => {
    let n = tree.get(dir);
    if (!n) {
      n = { dirs: new Set(), files: new Map() };
      tree.set(dir, n);
    }
    return n;
  };
  /** A file's relative path noted (its folders too). */
  const note = (rel: string, size: number, mtimeMs: number) => {
    const parts = rel.split("/");
    const name = parts.pop() as string;
    let dir = "";
    for (const part of parts) {
      node(dir).dirs.add(part);
      dir = dir ? `${dir}/${part}` : part;
    }
    node(dir).files.set(name, { size, mtimeMs });
  };
  for (const e of await native.list("")) note(e.path, e.size, e.mtime);

  /** A path relative to the root, from an absolute one or one already relative. */
  const rel = (path: string) =>
    path === root ? "" : path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  const split = (path: string) => {
    const r = rel(path);
    const i = r.lastIndexOf("/");
    return i < 0 ? { dir: "", name: r } : { dir: r.slice(0, i), name: r.slice(i + 1) };
  };
  const stat = (path: string) => {
    const { dir, name } = split(path);
    return tree.get(dir)?.files.get(name);
  };

  const fs: LibraryFs = {
    dirs: (path) => [...(tree.get(rel(path))?.dirs ?? [])],
    files: (path) => [...(tree.get(rel(path))?.files.keys() ?? [])],
    exists: (path) => !!stat(path) || tree.has(rel(path)),
    stat,
    readText: (path) => native.readText(rel(path)),
  };

  return {
    root,
    fs,
    /** An absolute path under the root. */
    abs: (r: string) => `${root}/${r}`,
    rel,
    has: (path: string) => !!stat(path),
    read: (path: string) => native.read(rel(path)),
    async write(path: string, bytes: Uint8Array) {
      await native.write(rel(path), bytes);
      note(rel(path), bytes.length, Date.now());
    },
    async remove(path: string) {
      const r = rel(path);
      await native.remove(r);
      const { dir, name } = split(r);
      tree.get(dir)?.files.delete(name);
      tree.get(dir)?.dirs.delete(name);
      for (const key of [...tree.keys()])
        if (key === r || key.startsWith(`${r}/`)) tree.delete(key);
    },
  };
}
export type Files = Awaited<ReturnType<typeof openFiles>> & {
  /** A file's bytes at once, where the files answer at once (Android). */
  readNow?(path: string): Uint8Array | undefined;
};

/** The app's files over the shared code's DataFs (Android: the native bridge): one view of them for
 *  the library, the databases and the storage adapters alike. */
export function filesOver(dataFs: DataFs, root: string): Files {
  const rel = (path: string) =>
    path === root ? "" : path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  const abs = (r: string) => (r.startsWith(`${root}/`) ? r : `${root}/${rel(r)}`);
  return {
    root,
    fs: libraryFs(dataFs),
    abs,
    rel,
    has: (path: string) => isFile(dataFs, abs(path)),
    /** A file's bytes at once (a database put there since the start). */
    readNow: (path: string) => dataFs.readBytes(abs(path)),
    read: async (path: string) =>
      isFile(dataFs, abs(path)) ? readAll(dataFs, abs(path)) : undefined,
    async write(path: string, bytes: Uint8Array) {
      dataFs.writeFile(abs(path), bytes);
    },
    async remove(path: string) {
      dataFs.remove(abs(path));
    },
  };
}
