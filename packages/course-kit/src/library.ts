// Reading installed courses from the library folder through a DataFs (library-over.ts reads them).
import type { DataFs } from "./data-fs.ts";
import { type LibraryFs, libraryOver } from "./library-over.ts";
import type { LibraryView } from "./library-view.ts";
import { verifyCourse } from "./verify.ts";

export { type InstalledCourse, type LibraryView, NotInstalledError } from "./library-view.ts";

/** What reading the library needs, of a DataFs. */
export function libraryFs(fs: DataFs): LibraryFs {
  const entries = (path: string, folders: boolean) =>
    fs.list(path).filter((name) => !!fs.stat(`${path}/${name}`)?.dir === folders);
  return {
    dirs: (path) => entries(path, true),
    files: (path) => entries(path, false),
    exists: (path) => !!fs.stat(path),
    stat(path) {
      const s = fs.stat(path);
      return s && { size: s.size, mtimeMs: s.mtimeMs };
    },
    async readText(path) {
      const text = fs.readText(path);
      if (text === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
      return text;
    },
  };
}

/** The library in `root` (the data root's `library/`), its courses checked by `verifyCourse`. */
export function openLibrary(fs: DataFs, root: string): LibraryView {
  return libraryOver(root, libraryFs(fs), (view, series, course, editions) =>
    verifyCourse(fs, view, series, course, editions),
  );
}
