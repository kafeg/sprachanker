// What moving a file between one's machines shares, for profile files (05) and course bundles (02):
// an export made ready once and downloaded once — let go after an hour —, one import at a time, and a
// full disk said as the learner's error.
import type { ErrorCode } from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";

/** An export prepared and not yet downloaded goes after an hour, its transfer with it. */
export const PREPARED_MS = 60 * 60_000;

/** A system error's code (ENOSPC: a full disk, found before writing or while writing). */
const codeOf = (error: unknown) => (error as { code?: string } | null)?.code;

/** What a file of untrusted names may make the disk refuse: a name too long, a file where its folder
 *  would be (or the other way), a name taken (another case of it). */
const REFUSED_NAMES = new Set(["ENAMETOOLONG", "ENOTDIR", "EISDIR", "EEXIST"]);

/**
 * A full disk as the learner's error (507 `not_enough_space`), an upload that stalled (408
 * `upload_stalled`), a series another import holds (409 `series_busy`), and — with `damaged`, for a
 * file imported — names the disk refuses as that file's damage (422); anything else as it is.
 */
export async function guarded<T>(work: () => Promise<T>, damaged?: ErrorCode): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const code = codeOf(error) ?? "";
    if (code === "ENOSPC") throw new ServiceError("not_enough_space", 507);
    if (code === "ETIMEDOUT") throw new ServiceError("upload_stalled", 408);
    if (code === "SERIES_BUSY") throw new ServiceError("series_busy", 409);
    if (damaged && REFUSED_NAMES.has(code)) throw new ServiceError(damaged, 422);
    throw error;
  }
}

/** Work that runs one at a time: another asked meanwhile is refused (409 `busy`). */
export function oneAtATime(busy: ErrorCode) {
  let running = false;
  return async <T>(work: () => Promise<T>) => {
    if (running) throw new ServiceError(busy, 409);
    running = true;
    try {
      return await work();
    } finally {
      running = false;
    }
  };
}

/**
 * Exports made ready, each its owner's (a profile, the server) until downloaded or an hour has
 * passed; `discard` lets its transfer go. `gone`: the error of one not there (404).
 */
export function preparedExports<T extends { fileName: string; bytes: number }>(
  discard: (id: string) => void,
  gone: ErrorCode,
) {
  const prepared = new Map<
    string,
    { owner: string; value: T; timer: ReturnType<typeof setTimeout> }
  >();
  /** Forgets one: downloaded (its stream has the transfer now), or let go with it. */
  const forget = (id: string, letGo: boolean) => {
    const p = prepared.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    prepared.delete(id);
    if (letGo) discard(id);
  };
  const self = {
    /** Kept for `owner` until downloaded, an hour at most. */
    keep(id: string, owner: string, value: T) {
      const timer = setTimeout(() => forget(id, true), PREPARED_MS);
      // Never what keeps the process (the command line) running.
      (timer as { unref?: () => void }).unref?.();
      prepared.set(id, { owner, value, timer });
    },
    /** One still there to download, `owner`'s: nothing taken (404 `gone` otherwise). */
    ready(owner: string, id: string): T {
      const p = prepared.get(id);
      if (!p || p.owner !== owner) throw new ServiceError(gone, 404);
      return p.value;
    },
    /** One taken to be downloaded, once. */
    take(owner: string, id: string): T {
      const value = self.ready(owner, id);
      forget(id, false);
      return value;
    },
    /** Whether one is still there to download, `owner`'s. */
    waiting: (owner: string, id: string) => prepared.get(id)?.owner === owner,
    /** One not downloaded let go (its transfer with it). */
    drop: (id: string) => forget(id, true),
    /** Every one of `owner`'s not downloaded let go. */
    letGo(owner: string) {
      for (const [id, p] of prepared) if (p.owner === owner) forget(id, true);
    },
  };
  return self;
}
