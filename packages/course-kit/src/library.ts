// Reading installed courses from the library folder through Node (library-over.ts reads them).
import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { type LibraryFs, libraryOver } from "./library-over.ts";
import type { LibraryView } from "./library-view.ts";
import { verifyCourse } from "./verify.ts";

export { type InstalledCourse, type LibraryView, NotInstalledError } from "./library-view.ts";

const entries = (path: string, folders: boolean) =>
  existsSync(path)
    ? readdirSync(path, { withFileTypes: true })
        .filter((d) => (folders ? d.isDirectory() : d.isFile()))
        .map((d) => d.name)
    : [];

const nodeFs: LibraryFs = {
  dirs: (path) => entries(path, true),
  files: (path) => entries(path, false),
  exists: existsSync,
  stat(path) {
    const stat = statSync(path, { throwIfNoEntry: false });
    return stat && { size: stat.size, mtimeMs: stat.mtimeMs };
  },
  readText: (path) => readFile(path, "utf8"),
};

export function openLibrary(root: string): LibraryView {
  return libraryOver(root, nodeFs, verifyCourse);
}
