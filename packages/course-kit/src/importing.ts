// What every import does: raw pages kept once and counted, and the report it returns. A provider
// states only what is its own (which pages, which media, how it normalises).
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MediaIndex } from "@sprachanker/schema";
import { writeFileAtomic } from "./files.ts";
import { failedMedia, goneMedia } from "./media-index.ts";
import type { ImportOptions, ImportReport, NormaliseResult } from "./provider.ts";

/** The report of an import with nothing to do (no course of it asked for). */
export const emptyReport = (): ImportReport => ({ failedMedia: [], goneMedia: [], normalised: {} });

/** A course normalised in an edition as the report names it: "<course> <edition>". */
export const reportKey = (course: string, edition: string) => `${course} ${edition}`;

/** An import's report: the series' media not fetched (its media index) and each course normalised,
 *  by `reportKey`. */
export const importReport = (
  index: MediaIndex,
  normalised: Record<string, NormaliseResult> = {},
): ImportReport => ({ failedMedia: failedMedia(index), goneMedia: goneMedia(index), normalised });

/** The raw pages of an import, by their path in the series folder (`raw/…`). */
export interface RawPages {
  /** A page fetched once and kept as it is; later imports read the kept copy unless `refresh`. */
  text(path: string, fetch: () => Promise<string>, refresh?: boolean): Promise<string>;
  /** The same for a file of bytes (a PDF). */
  bytes(path: string, fetch: () => Promise<Uint8Array>): Promise<Uint8Array>;
  /** A page kept another way (a walk of forms): counted, its time taken. */
  kept(path: string): void;
  /** When the newest page read so far was kept (ms): an exam's sources were read then. */
  readAt(): number;
}

/** Raw pages kept in `seriesDir`, each one read or fetched counted for the progress (`pages`). */
export function rawPages(
  seriesDir: string,
  options: Pick<ImportOptions, "refresh" | "progress">,
): RawPages {
  let done = 0;
  const read = new Set<string>();
  const kept = (path: string) => {
    read.add(join(seriesDir, path));
    options.progress?.({ phase: "pages", done: ++done });
  };
  async function stored<T extends string | Uint8Array>(
    path: string,
    load: (file: string) => Promise<T>,
    fetch: () => Promise<T>,
    refresh = options.refresh,
  ): Promise<T> {
    const file = join(seriesDir, path);
    let data: T;
    if (!refresh && existsSync(file)) data = await load(file);
    else {
      data = await fetch();
      // Whole or not at all: a page cut off by a crash would be taken as kept.
      await writeFileAtomic(file, data);
    }
    kept(path);
    return data;
  }
  return {
    text: (path, fetch, refresh) => stored(path, (f) => readFile(f, "utf8"), fetch, refresh),
    bytes: (path, fetch) => stored(path, async (f) => new Uint8Array(await readFile(f)), fetch),
    kept,
    readAt: () => Math.round(Math.max(0, ...[...read].map((f) => statSync(f).mtimeMs))),
  };
}
