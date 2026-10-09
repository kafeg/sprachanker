// Writing library files safely (02, 03): a file is replaced whole or not at all, so a crash or a quit
// midway never leaves a half-written page, lesson or index that later runs would take as stored.
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
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
