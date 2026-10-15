// What the shared code needs of a file system — the importers, a course bundle, the server's deck
// folders, transfers and model files: the desktop gives Node's (node-fs.ts), the phone app its own
// (apps/mobile). Paths are absolute and POSIX, joined by the helpers here. Small things are
// synchronous (a folder listed, a file's size, a short file read or written whole); what may be large
// is streamed. A failure is an Error with Node's `code` (ENOENT, EEXIST, ENOSPC, EXDEV …).

/** A file's or folder's size and time of change. */
export interface FileInfo {
  size: number;
  mtimeMs: number;
  dir: boolean;
}

/** The disk of a folder: the bytes free for this user, and its size. */
export interface Disk {
  free: number;
  size: number;
}

/** A file's sha256, size and CRC-32 (a zip's own check). */
export interface FileSums {
  sha256: string;
  size: number;
  crc32: number;
}

export interface DataFs {
  /** What is there; undefined when nothing is. */
  stat(path: string): FileInfo | undefined;
  /** The names in a folder ([] when there is none). */
  list(path: string): string[];
  /** A short file's text (UTF-8); undefined when there is none. */
  readText(path: string): string | undefined;
  /** A short file's bytes, or `length` of them from `start` (fewer at its end); undefined when there
   *  is none. */
  readBytes(path: string, start?: number, length?: number): Uint8Array | undefined;
  /** A short file written whole, its folders made: beside it first, then renamed into place. */
  writeFile(path: string, data: string | Uint8Array): void;
  /** A folder and those above it. */
  mkdir(path: string): void;
  /** Renamed (moved on the same disk); a folder too. One there is replaced, as rename(2) does. */
  rename(from: string, to: string): void;
  /** A file or a folder with all in it; nothing when it is not there. */
  remove(path: string): void;
  /** An empty folder removed; ENOTEMPTY when it is not. */
  removeDir(path: string): void;
  /** `to` made a hard link of `from`; EEXIST when `to` is there, EXDEV (or EPERM, ENOTSUP) where the
   *  disk has none. */
  link(from: string, to: string): void;
  /** `from` copied to `to`; EEXIST when `to` is there. */
  copy(from: string, to: string): void;
  /** Its time of change set to now. */
  touch(path: string): void;
  /** The disk the path is on; null when the system does not say. */
  disk(path: string): Disk | null;
  /** A file's bytes, the range `start`..`end` (inclusive) or all, as chunks. */
  stream(path: string, start?: number, end?: number): AsyncIterable<Uint8Array>;
  /** Chunks written to a new file (one there is replaced; its folders made), hashed on the way; past
   *  `max` bytes it stops: undefined, and what was written is left for the caller. `sync`: flushed
   *  to the disk before it ends (a file about to be renamed into place); `mode`: its permissions
   *  where the system has them (a profile file saved: its owner's only). */
  write(
    path: string,
    chunks: AsyncIterable<Uint8Array>,
    options?: { max?: number; sync?: boolean; mode?: number },
  ): Promise<{ sha256: string; size: number } | undefined>;
  /** A file's sums, read as a stream. */
  sums(path: string): Promise<FileSums>;
}

/** Path parts joined, `.` and `..` resolved (POSIX). */
export function joinPath(...parts: string[]) {
  const absolute = parts[0]?.startsWith("/");
  const out: string[] = [];
  for (const part of parts.join("/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `${absolute ? "/" : ""}${out.join("/")}`;
}

/** The folder of a path ("/" for one at the top, "." for a bare name). */
export function dirName(path: string) {
  const trimmed = path.replace(/\/+$/, "");
  const i = trimmed.lastIndexOf("/");
  return i < 0 ? "." : i === 0 ? "/" : trimmed.slice(0, i);
}

/** The last part of a path. */
export const baseName = (path: string) => path.replace(/\/+$/, "").split("/").pop() ?? "";

/** A path's extension with its dot ("" when it has none; a name starting with a dot has none). */
export function extName(path: string) {
  const name = baseName(path);
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i);
}

/** An error as the file systems give one: its message and Node's code. */
export const fsError = (code: string, message: string) =>
  Object.assign(new Error(`${code}: ${message}`), { code });

/** The code of a file system's error ("" when it has none). */
export const errorCode = (error: unknown) => String((error as { code?: unknown })?.code ?? "");

/** Whether a path is a file. */
export const isFile = (fs: DataFs, path: string) => {
  const info = fs.stat(path);
  return !!info && !info.dir;
};

/** Whether a path is a folder. */
export const isDir = (fs: DataFs, path: string) => !!fs.stat(path)?.dir;

/** Every file under a folder, its path relative to the folder ("a/b.json"). */
export function listFiles(fs: DataFs, dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const name of fs.list(rel ? joinPath(dir, rel) : dir)) {
      const path = rel ? `${rel}/${name}` : name;
      if (fs.stat(joinPath(dir, path))?.dir) walk(path);
      else out.push(path);
    }
  };
  walk("");
  return out;
}

/** A file's bytes read whole through its stream (one too large to read at once on a phone). */
export async function readAll(fs: DataFs, path: string): Promise<Uint8Array<ArrayBuffer>> {
  const info = fs.stat(path);
  if (!info || info.dir) throw fsError("ENOENT", path);
  // One buffer of the file's size, filled as it is read (a package of hundreds of megabytes).
  let out = new Uint8Array(info.size);
  let at = 0;
  for await (const part of fs.stream(path)) {
    if (at + part.byteLength > out.length) {
      const grown = new Uint8Array(Math.max(out.length * 2, at + part.byteLength));
      grown.set(out.subarray(0, at));
      out = grown;
    }
    out.set(part, at);
    at += part.byteLength;
  }
  return at === out.length ? out : out.slice(0, at);
}

/** Bytes as chunks (what `write` takes). */
export async function* chunksOf(data: string | Uint8Array) {
  yield typeof data === "string" ? new TextEncoder().encode(data) : data;
}
