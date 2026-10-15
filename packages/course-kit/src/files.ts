// Writing library files safely: a file is replaced whole or not at all, so a crash or a quit
// midway never leaves a half-written page, lesson or index that later runs would take as stored.
import { chunksOf, type DataFs, errorCode } from "./data-fs.ts";

/** This process's id where the runtime has one (the phone's page has none: 0). */
const pid = () => (globalThis as { process?: { pid?: number } }).process?.pid ?? 0;

/** A temporary name next to `target` (same folder, so the rename is atomic), unique per call. */
export const tempFile = (target: string) =>
  `${target}.tmp-${pid()}-${crypto.randomUUID().slice(0, 8)}`;

/** A file `tempFile` named: left behind when the process stopped before it was renamed. */
export const isTempFile = (path: string) => /\.tmp-\d+-[0-9a-f]{8}$/.test(path);

/** Writes `data` to a temporary file, flushes it to disk, then renames it over `target`. */
export async function writeFileAtomic(
  fs: DataFs,
  target: string,
  data: string | Uint8Array,
): Promise<void> {
  const tmp = tempFile(target);
  try {
    await fs.write(tmp, chunksOf(data), { sync: true });
    fs.rename(tmp, target);
  } catch (error) {
    fs.remove(tmp);
    throw error;
  }
}

/** sha256 and size of a file, read as a stream (media can be large). */
export async function hashFile(
  fs: DataFs,
  path: string,
): Promise<{ sha256: string; size: number }> {
  const { sha256, size } = await fs.sums(path);
  return { sha256, size };
}

/** Errors of a disk that has no hard links (or not across these folders): a copy instead. */
const NO_LINKS = new Set(["EXDEV", "EPERM", "ENOTSUP", "EOPNOTSUPP", "EMLINK"]);

/**
 * `to` made the same file as `from`: a hard link, else — only where the disk has none — a copy
 * (`beforeCopy` first: the room for it). Never over a file there: one there (by another case or
 * Unicode form of its name, on a disk that does not tell them apart) is an error (EEXIST).
 */
export function linkOrCopy(fs: DataFs, from: string, to: string, beforeCopy?: () => void) {
  try {
    fs.link(from, to);
  } catch (error) {
    if (!NO_LINKS.has(errorCode(error))) throw error;
    beforeCopy?.();
    fs.copy(from, to);
  }
}
