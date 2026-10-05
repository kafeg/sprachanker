// Content-addressed blob store of a series folder: blobs/sha256/ab/cd/<hash> (02).
import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sha256Hex } from "./fingerprint.ts";

export interface BlobStore {
  path(sha256: string): string;
  has(sha256: string): boolean;
  put(bytes: Uint8Array): Promise<{ sha256: string; size: number }>;
}

export function createBlobStore(seriesDir: string): BlobStore {
  const path = (hash: string) =>
    join(seriesDir, "blobs/sha256", hash.slice(0, 2), hash.slice(2, 4), hash);
  return {
    path,
    has: (hash) => existsSync(path(hash)),
    async put(bytes) {
      const sha256 = sha256Hex(bytes);
      const target = path(sha256);
      if (!existsSync(target)) {
        await mkdir(dirname(target), { recursive: true });
        const tmp = `${target}.tmp-${process.pid}`;
        await writeFile(tmp, bytes);
        await rename(tmp, target);
      }
      return { sha256, size: bytes.byteLength };
    },
  };
}
