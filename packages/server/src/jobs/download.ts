// Large verified downloads (models, 06 "Downloads"): resumable through `<dest>.part`, sha256 and size
// checked before the file appears under its final name. A stopped download keeps its part file.
import { createHash, type Hash } from "node:crypto";
import { createReadStream, renameSync, rmSync, statSync } from "node:fs";
import { open } from "node:fs/promises";

export interface DownloadOptions {
  url: string;
  dest: string;
  size: number;
  sha256: string;
  fetch: typeof fetch;
  signal?: AbortSignal;
  /** Bytes on disk so far, including a resumed part. */
  onProgress?(received: number): void;
}

export class DownloadError extends Error {}

export const partFile = (dest: string) => `${dest}.part`;

/** Bytes of an interrupted download of `dest`, if any. */
export const partSize = (dest: string) =>
  statSync(partFile(dest), { throwIfNoEntry: false })?.size ?? 0;

async function hashFile(file: string, hash: Hash): Promise<void> {
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
}

export async function download(o: DownloadOptions): Promise<void> {
  const part = partFile(o.dest);
  let have = partSize(o.dest);
  if (have > o.size) {
    rmSync(part);
    have = 0;
  }
  const hash = createHash("sha256");
  if (have > 0) await hashFile(part, hash);

  if (have < o.size) {
    const res = await o.fetch(o.url, {
      headers: have > 0 ? { range: `bytes=${have}-` } : {},
      signal: o.signal,
    });
    if (!res.ok || !res.body) throw new DownloadError(`${o.url}: HTTP ${res.status}`);
    // A server that ignores the range sends the whole file: start over.
    if (have > 0 && res.status !== 206) {
      await res.body.cancel();
      rmSync(part);
      return download(o);
    }
    const file = await open(part, have > 0 ? "a" : "w");
    try {
      let received = have;
      for await (const chunk of res.body) {
        await file.write(chunk);
        hash.update(chunk);
        received += chunk.length;
        o.onProgress?.(received);
      }
      have = received;
    } finally {
      await file.close();
    }
  }

  const sha = hash.digest("hex");
  if (have !== o.size || sha !== o.sha256) {
    rmSync(part, { force: true });
    throw new DownloadError(
      `${o.url}: got ${have} bytes, sha256 ${sha}; expected ${o.size}, ${o.sha256}`,
    );
  }
  renameSync(part, o.dest);
}
