// Writing library files safely: a file is replaced whole or not at all, so a crash or a quit
// midway never leaves a half-written page, lesson or index that later runs would take as stored.
import { createHash, randomUUID } from "node:crypto";
import { constants, copyFileSync, createReadStream, linkSync } from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

/** A temporary name next to `target` (same folder, so the rename is atomic), unique per call. */
export const tempFile = (target: string) =>
  `${target}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;

/** A file `tempFile` named: left behind when the process stopped before it was renamed. */
export const isTempFile = (path: string) => /\.tmp-\d+-[0-9a-f]{8}$/.test(path);

/** Writes `data` to a temporary file, flushes it to disk, then renames it over `target`. */
export async function writeFileAtomic(target: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const tmp = tempFile(target);
  const handle = await open(tmp, "w");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, target);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

/** sha256 and size of a file, read as a stream (media can be large). */
export async function hashFile(path: string): Promise<{ sha256: string; size: number }> {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
    size += (chunk as Buffer).length;
  }
  return { sha256: hash.digest("hex"), size };
}

/** Errors of a disk that has no hard links (or not across these folders): a copy instead. */
const NO_LINKS = new Set(["EXDEV", "EPERM", "ENOTSUP", "EOPNOTSUPP", "EMLINK"]);

/**
 * `to` made the same file as `from`: a hard link, else — only where the disk has none — a copy
 * (`beforeCopy` first: the room for it). Never over a file there: one there (by another case or
 * Unicode form of its name, on a disk that does not tell them apart) is an error (EEXIST).
 */
export function linkOrCopy(from: string, to: string, beforeCopy?: () => void) {
  try {
    linkSync(from, to);
  } catch (error) {
    if (!NO_LINKS.has((error as { code?: string }).code ?? "")) throw error;
    beforeCopy?.();
    copyFileSync(from, to, constants.COPYFILE_EXCL);
  }
}
