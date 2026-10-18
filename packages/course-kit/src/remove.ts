// A course removed from the library: its canonical and locale folders, its
// exams' source copies, and the media its files name that no other course of its series names (media
// are one file per content in a series, shared — a course's videos may be its other editions' too).
// The media index forgets the files removed (a download fetches them again); the key map stays, so a
// course installed again keeps its keys and the learner's progress meets it, and so does its practice
// made by the model (`practice/`) and its recordings heard (`heard/`). The series' lock is the
// caller's.
import { EditionId, MediaIndex, SeriesKey, Slug } from "@sprachanker/schema";
import { courseBundleContent } from "./bundle.ts";
import { type DataFs, joinPath } from "./data-fs.ts";
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
  fs: DataFs,
  libraryRoot: string,
  series: string,
  courseId: string,
): Promise<RemovedCourse> {
  if (!SeriesKey.safeParse(series).success || !Slug.safeParse(courseId).success)
    throw new NotInstalledError(`${series}/${courseId}`);
  const seriesDir = joinPath(libraryRoot, series);
  const own = await courseBundleContent(fs, libraryRoot, series, [courseId]);
  // What the series' other courses name; one that does not read keeps every media file.
  const others = openLibrary(fs, libraryRoot)
    .courses()
    .filter((c) => c.series === series && c.course !== courseId);
  const used = new Set<string>();
  let unknown = false;
  for (const other of others) {
    const content = await courseBundleContent(fs, libraryRoot, series, [other.course]).catch(
      () => undefined,
    );
    if (!content) unknown = true;
    for (const f of content?.files ?? []) used.add(f.path);
  }
  const media = own.files.filter((f) => f.path.startsWith("media/"));
  // Its practice and recordings heard stay (as the key map): made over hours, they are the course's
  // again once it is back.
  const gone = own.files.filter(
    (f) =>
      !f.path.startsWith("practice/") &&
      !f.path.startsWith("heard/") &&
      (!f.path.startsWith("media/") || (!unknown && !used.has(f.path))),
  );
  let bytes = 0;
  for (const f of gone) bytes += fs.stat(f.file)?.size ?? 0;

  // The media index first: a file it names that is gone is fetched again; one it no longer names
  // that is still there is only left over.
  const removedMedia = new Set(gone.filter((f) => f.path.startsWith("media/")).map((f) => f.path));
  const indexFile = joinPath(seriesDir, "media.json");
  const indexText = fs.readText(indexFile);
  if (removedMedia.size && indexText !== undefined) {
    const index = MediaIndex.parse(JSON.parse(indexText));
    const kept = Object.fromEntries(
      Object.entries(index).filter(([, e]) => !("path" in e) || !removedMedia.has(e.path)),
    );
    await writeFileAtomic(fs, indexFile, JSON.stringify(kept, null, 1));
  }
  for (const f of gone) fs.remove(f.file);
  // The course's folders whole (a file a bundle would not hold, too), then the download's marker and
  // the hearing step's (its recordings heard stay, as its practice).
  fs.remove(joinPath(seriesDir, "canonical", courseId));
  for (const edition of own.courses[0]?.editions ?? [])
    if (EditionId.safeParse(edition).success)
      fs.remove(joinPath(seriesDir, "locale", edition, courseId));
  fs.remove(joinPath(seriesDir, ".downloads", `${courseId}.json`));
  fs.remove(joinPath(seriesDir, ".heard", `${courseId}.json`));
  // Nothing left behind empty: a media index naming nothing, folders holding nothing.
  const left = fs.readText(indexFile);
  if (left !== undefined && !Object.keys(JSON.parse(left)).length) fs.remove(indexFile);
  removeEmpty(fs, seriesDir);
  return { files: gone.length, bytes, shared: media.length - removedMedia.size };
}

/** Removes the empty folders under `dir` (the series folder itself stays: its key map), never the
 *  import lock's. */
function removeEmpty(fs: DataFs, dir: string) {
  for (const name of fs.list(dir)) {
    const sub = joinPath(dir, name);
    if (!fs.stat(sub)?.dir || name.startsWith(SERIES_LOCK)) continue;
    removeEmpty(fs, sub);
    if (!fs.list(sub).length) fs.removeDir(sub);
  }
}
