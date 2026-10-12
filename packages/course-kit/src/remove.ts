// A course removed from the library: its canonical and locale folders, its
// exams' source copies, and the media its files name that no other course of its series names (media
// are one file per content in a series, shared — a course's videos may be its other editions' too).
// The media index forgets the files removed (a download fetches them again); the key map stays, so a
// course installed again keeps its keys and the learner's progress meets it. The series' lock is the
// caller's.
import { existsSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { EditionId, MediaIndex, SeriesKey, Slug } from "@sprachanker/schema";
import { courseBundleContent } from "./bundle.ts";
import { writeFileAtomic } from "./files.ts";
import { NotInstalledError, openLibrary } from "./library.ts";

/** The series' import lock: a folder of this name in the series folder, and while it is taken a
 *  process's own beside it (`<name>.<pid>-<time>`, empty a moment before it holds the pid). The lock
 *  is the caller's; nothing here touches either. */
export const SERIES_LOCK = ".import-lock";

export interface RemovedCourse {
  /** Files removed, and their bytes. */
  files: number;
  bytes: number;
  /** Media files kept because another course of the series names them. */
  shared: number;
}

export async function removeCourse(
  libraryRoot: string,
  series: string,
  courseId: string,
): Promise<RemovedCourse> {
  if (!SeriesKey.safeParse(series).success || !Slug.safeParse(courseId).success)
    throw new NotInstalledError(`${series}/${courseId}`);
  const seriesDir = join(libraryRoot, series);
  const own = await courseBundleContent(libraryRoot, series, courseId);
  // What the series' other courses name; one that does not read keeps every media file.
  const others = openLibrary(libraryRoot)
    .courses()
    .filter((c) => c.series === series && c.course !== courseId);
  const used = new Set<string>();
  let unknown = false;
  for (const other of others) {
    const content = await courseBundleContent(libraryRoot, series, other.course).catch(
      () => undefined,
    );
    if (!content) unknown = true;
    for (const f of content?.files ?? []) used.add(f.path);
  }
  const media = own.files.filter((f) => f.path.startsWith("media/"));
  const gone = own.files.filter(
    (f) => !f.path.startsWith("media/") || (!unknown && !used.has(f.path)),
  );
  let bytes = 0;
  for (const f of gone) bytes += statSync(f.file, { throwIfNoEntry: false })?.size ?? 0;

  // The media index first: a file it names that is gone is fetched again; one it no longer names
  // that is still there is only left over.
  const removedMedia = new Set(gone.filter((f) => f.path.startsWith("media/")).map((f) => f.path));
  const indexFile = join(seriesDir, "media.json");
  if (removedMedia.size && existsSync(indexFile)) {
    const index = MediaIndex.parse(JSON.parse(readFileSync(indexFile, "utf8")));
    const kept = Object.fromEntries(
      Object.entries(index).filter(([, e]) => !("path" in e) || !removedMedia.has(e.path)),
    );
    await writeFileAtomic(indexFile, JSON.stringify(kept, null, 1));
  }
  for (const f of gone) rmSync(f.file, { force: true });
  // The course's folders whole (a file a bundle would not hold, too), then the download's marker.
  rmSync(join(seriesDir, "canonical", courseId), { recursive: true, force: true });
  for (const edition of own.editions)
    if (EditionId.safeParse(edition).success)
      rmSync(join(seriesDir, "locale", edition, courseId), { recursive: true, force: true });
  rmSync(join(seriesDir, ".downloads", `${courseId}.json`), { force: true });
  // Nothing left behind empty: a media index naming nothing, folders holding nothing.
  if (existsSync(indexFile) && !Object.keys(JSON.parse(readFileSync(indexFile, "utf8"))).length)
    rmSync(indexFile);
  removeEmpty(seriesDir);
  return { files: gone.length, bytes, shared: media.length - removedMedia.size };
}

/** Removes the empty folders under `dir` (the series folder itself stays: its key map), never the
 *  import lock's. */
function removeEmpty(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(SERIES_LOCK)) continue;
    const sub = join(dir, entry.name);
    removeEmpty(sub);
    if (!readdirSync(sub).length) rmdirSync(sub);
  }
}
