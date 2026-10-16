// Course bundles, the library's side: what a bundle of a series' courses holds — their library
// files of the editions asked, the media they use (each once), their exams' source copies, its lines of media.json
// and keys.json, its content versions —, and a bundle unpacked beside the library checked and
// installed into it. Zips and transfer folders are the server's; a bundle is untrusted input, so every
// file is checked here before anything of it is moved into place.
import {
  bundlePathCourse,
  type CourseBundleManifest,
  CourseBundlePath,
  CourseIndex,
  courseIdOf,
  EditionId,
  Exam,
  ExamSources,
  KeyMapFile,
  Lesson,
  LocaleCourse,
  LocaleExam,
  LocaleLesson,
  MediaIndex,
  mergePractice,
  PracticeLesson,
  practiceRecordings,
  SeriesKey,
  Slug,
} from "@sprachanker/schema";
import type { z } from "zod";
import { prettyJson } from "./canonical-json.ts";
import { type DataFs, dirName, joinPath, listFiles } from "./data-fs.ts";
import { hashFile, linkOrCopy, writeFileAtomic } from "./files.ts";
import { Sha256 } from "./hash.ts";
import { NotInstalledError, openLibrary } from "./library.ts";
import { type LibraryFile, libraryFile } from "./provider.ts";
import { mediaPaths } from "./verify.ts";

/** A file a bundle holds: its path in the series folder, and where it is on disk. */
export interface BundleFile {
  path: string;
  file: string;
}

/** A bundle's library JSON files: what the content versions and the schema checks cover. */
const isLibraryJson = (path: string) =>
  path.startsWith("canonical/") ||
  path.startsWith("locale/") ||
  (path.startsWith("practice/") && path.endsWith(".json"));
/** A practice's lesson file (not one of its recordings). */
const isPracticeJson = (path: string) => path.startsWith("practice/") && path.endsWith(".json");

/** A file of a bundle that is never rewritten where it is: a media file (other content gets another
 *  name) or a practice recording. Its library files and source copies are: a later import or practice
 *  made replaces them. */
export const writtenOnce = (path: string) =>
  path.startsWith("media/") || (path.startsWith("practice/") && !isPracticeJson(path));

/** A media address with a fragment names a part of a fetched document that the importer made a file
 *  of (Leben in Deutschland's pictures out of the catalogue PDF, the PDF's hash in the fragment): the
 *  file is the importer's own making, its bytes those of the version that made it. */
const madeByImporter = (url: string) => url.includes("#");

/** Paths of the files under `dir` (a course's folder), as series paths under `prefix`, that a bundle
 *  may hold (a temporary file an import left is none). */
function filesUnder(fs: DataFs, seriesDir: string, prefix: string) {
  return listFiles(fs, joinPath(seriesDir, prefix))
    .map((path) => `${prefix}/${path}`)
    .filter((path) => CourseBundlePath.safeParse(path).success)
    .sort();
}

/** The editions of a course installed in a series folder. */
function installedEditions(fs: DataFs, seriesDir: string, courseId: string) {
  const locale = joinPath(seriesDir, "locale");
  return fs
    .list(locale)
    .filter((e) => EditionId.safeParse(e).success)
    .filter((e) => fs.stat(joinPath(locale, e, courseId, "course.json")))
    .sort();
}

/** A JSON file read (one not there is an error, ENOENT). */
const readJson = async (fs: DataFs, file: string): Promise<unknown> => {
  const text = fs.readText(file);
  if (text === undefined) throw Object.assign(new Error(`ENOENT: ${file}`), { code: "ENOENT" });
  return JSON.parse(text);
};

/** A series' media index and key map, as stored (none yet: empty); one that does not read throws. */
async function seriesState(fs: DataFs, seriesDir: string) {
  const read = async (name: string) => {
    const file = joinPath(seriesDir, name);
    return fs.stat(file) ? await readJson(fs, file) : {};
  };
  return {
    media: MediaIndex.parse(await read("media.json")),
    keys: KeyMapFile.parse(await read("keys.json")),
  };
}

/** A course's part of a bundle: what it is, its library files, and what they name — media and the
 *  copies its exams were read from — on disk. */
async function courseContent(
  fs: DataFs,
  library: ReturnType<typeof openLibrary>,
  seriesDir: string,
  series: string,
  courseId: string,
  editions?: string[],
) {
  if (!Slug.safeParse(courseId).success) throw new NotInstalledError(`${series}/${courseId}`);
  const index = await library.courseIndex(series, courseId);
  const installed = installedEditions(fs, seriesDir, courseId);
  const chosen = editions ?? installed;
  const absent = chosen.filter((e) => !installed.includes(e));
  if (!chosen.length || absent.length)
    throw new NotInstalledError(`${index.key} ${absent.join(", ") || "(no edition)"}`);
  const titles: Record<string, string> = {};
  for (const edition of chosen) {
    const locale = await library.localeCourse(series, courseId, edition);
    if (locale) titles[edition] = locale.title;
  }
  const json = [
    ...filesUnder(fs, seriesDir, `canonical/${courseId}`),
    ...chosen.flatMap((e) => filesUnder(fs, seriesDir, `locale/${e}/${courseId}`)),
  ];
  // What the files name: media, and the copies an exam was read from.
  const named = new Set<string>();
  const raw = new Set<string>();
  for (const path of json) {
    const value = await readJson(fs, joinPath(seriesDir, path));
    mediaPaths(value, named);
    if (path.includes("/sources/"))
      for (const d of ExamSources.safeParse(value).data?.documents ?? []) if (d.raw) raw.add(d.raw);
  }
  const present = (paths: Set<string>, fileOf: (path: string) => string | undefined) =>
    [...paths]
      .sort()
      .filter((path) => CourseBundlePath.safeParse(path).success)
      // A copy outside the course's own folder of `raw/` is no bundle's (it could be another's).
      .filter((path) => !path.startsWith("raw/") || bundlePathCourse(path) === courseId)
      .flatMap((path) => {
        const file = fileOf(path);
        return file ? [{ path, file }] : [];
      });
  // Each edition's practice made for the course, and the recordings it names.
  const practice = chosen.flatMap((e) =>
    filesUnder(fs, seriesDir, `practice/${e}/${courseId}`).filter(isPracticeJson),
  );
  const recorded = new Set<string>();
  for (const path of practice) {
    const lesson = PracticeLesson.safeParse(await readJson(fs, joinPath(seriesDir, path)));
    for (const r of lesson.success ? practiceRecordings(lesson.data) : []) recorded.add(r);
  }
  const lessons = index.units.some((u) => u.lessons.length);
  return {
    course: index.key,
    kind: !lessons && index.exams.length ? ("exam" as const) : ("course" as const),
    editions: chosen,
    source: index.source ?? null,
    titles,
    json: [...json, ...practice],
    media: present(named, (p) => library.mediaFile(series, p)),
    copies: [
      ...present(raw, (p) => library.rawFile(series, p)),
      ...present(recorded, (p) => library.practiceFile(series, p)),
    ],
  };
}

/**
 * What a bundle of courses of one series holds (`editions`: those asked of each, else every one
 * installed): their canonical files, each edition's locale files, the media they name that are on
 * disk — each once, however many of the courses name it —, the copies their exams were read from,
 * their lines of the series' media index (those of the media it holds) and key map (the scopes under
 * its courses). NotInstalledError when a course or an edition asked is not here.
 */
export async function courseBundleContent(
  fs: DataFs,
  libraryRoot: string,
  series: string,
  courseIds: readonly string[],
  editions?: string[],
) {
  if (!SeriesKey.safeParse(series).success || !courseIds.length)
    throw new NotInstalledError(`${series}/${courseIds.join(",")}`);
  const library = openLibrary(fs, libraryRoot);
  const seriesDir = joinPath(libraryRoot, series);
  const courses = [];
  for (const id of [...new Set(courseIds)].sort())
    courses.push(await courseContent(fs, library, seriesDir, series, id, editions));
  const media = new Map<string, BundleFile>();
  for (const c of courses) for (const m of c.media) media.set(m.path, m);
  const state = await seriesState(fs, seriesDir);
  const prefixes = courses.map((c) => `${c.course}/`);
  return {
    courses: courses.map(({ course, kind, editions, source, titles }) => ({
      course,
      kind,
      editions,
      source,
      titles,
    })),
    media: Object.fromEntries(
      Object.entries(state.media).filter(([, e]) => "path" in e && media.has(e.path)),
    ) as MediaIndex,
    keys: Object.fromEntries(
      Object.entries(state.keys).filter(([scope]) => prefixes.some((p) => scope.startsWith(p))),
    ) as KeyMapFile,
    files: [
      ...courses.flatMap((c) => c.json.map((path) => ({ path, file: joinPath(seriesDir, path) }))),
      ...[...media.values()].sort((a, b) => (a.path < b.path ? -1 : 1)),
      ...courses.flatMap((c) => c.copies),
    ],
  };
}

/**
 * A series' installed courses grouped for bundles: courses sharing most of their media — a course in
 * several languages, its videos the same — are one group (more than half the bytes of the smaller
 * one's media in common), so those videos are in one bundle only; courses sharing a few files (a
 * level's sound or picture another level uses too) stay apart, those files in each. Each group
 * sorted, the groups by their first course.
 */
export async function bundleGroups(fs: DataFs, libraryRoot: string, series: string) {
  const library = openLibrary(fs, libraryRoot);
  const seriesDir = joinPath(libraryRoot, series);
  const ids = library
    .courses()
    .filter((c) => c.series === series)
    .map((c) => c.course);
  // Each course's media with their sizes.
  const media = new Map<string, Map<string, number>>();
  for (const id of ids) {
    const content = await courseContent(fs, library, seriesDir, series, id);
    media.set(id, new Map(content.media.map((m) => [m.path, fs.stat(m.file)?.size ?? 0])));
  }
  const total = (m: Map<string, number>) => [...m.values()].reduce((n, b) => n + b, 0);
  // Union–find over courses, joined where they share most of their media.
  const parent = new Map(ids.map((id) => [id, id]));
  const root = (id: string): string => {
    const up = parent.get(id) as string;
    return up === id ? id : root(up);
  };
  for (const [i, a] of ids.entries())
    for (const b of ids.slice(i + 1)) {
      const ma = media.get(a) as Map<string, number>;
      const mb = media.get(b) as Map<string, number>;
      let shared = 0;
      for (const [path, bytes] of ma) if (mb.has(path)) shared += bytes;
      if (shared > 0 && shared * 2 > Math.min(total(ma), total(mb))) parent.set(root(a), root(b));
    }
  const groups = new Map<string, string[]>();
  for (const id of ids) groups.set(root(id), [...(groups.get(root(id)) ?? []), id]);
  return [...groups.values()]
    .map((g) => g.sort())
    .sort((a, b) => ((a[0] ?? "") < (b[0] ?? "") ? -1 : 1));
}
export type CourseBundleContent = Awaited<ReturnType<typeof courseBundleContent>>;

/** A content version: a sha256 over the files' paths and hashes, in path order. */
function versionOf(files: ReadonlyArray<{ path: string; sha256: string }>) {
  const hash = new Sha256();
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : 1)))
    hash.update(`${f.path} ${f.sha256}\n`);
  return hash.hex();
}

/** A course's content versions from its files: of its canonical files, of each edition's locale
 *  files, and of each edition's practice there is (its lessons and recordings). */
export function contentVersions(
  courseId: string,
  editions: readonly string[],
  files: ReadonlyArray<{ path: string; sha256: string }>,
) {
  const under = (prefix: string) => files.filter((f) => f.path.startsWith(prefix));
  const of = (prefix: string) => versionOf(under(prefix));
  const practiced = editions.filter((e) => under(`practice/${e}/${courseId}/`).length);
  return {
    canonical: of(`canonical/${courseId}/`),
    editions: Object.fromEntries(editions.map((e) => [e, of(`locale/${e}/${courseId}/`)])),
    ...(practiced.length && {
      practice: Object.fromEntries(practiced.map((e) => [e, of(`practice/${e}/${courseId}/`)])),
    }),
  };
}

/** The content versions of a course as installed (null where a folder is not there). */
async function installedVersions(
  fs: DataFs,
  seriesDir: string,
  courseId: string,
  editions: string[],
) {
  const of = async (prefix: string) => {
    if (!fs.stat(joinPath(seriesDir, prefix, "course.json"))) return null;
    const files = [];
    for (const path of filesUnder(fs, seriesDir, prefix))
      files.push({ path, sha256: (await hashFile(fs, joinPath(seriesDir, path))).sha256 });
    return versionOf(files);
  };
  const editionVersions: Record<string, string | null> = {};
  for (const e of editions) editionVersions[e] = await of(`locale/${e}/${courseId}`);
  return { canonical: await of(`canonical/${courseId}`), editions: editionVersions };
}

/** What becomes of each media file and source copy of a bundle, against the series folder. */
export interface BundlePlan {
  /** Unpacked from the bundle. */
  unpack: Set<string>;
  /** Already there with the same content: left as it is. */
  skip: Set<string>;
  /** There with other content made by the importer from the same part of the same document, by
   *  another version of it (a picture encoded otherwise): ours kept, as it is. */
  keep: Set<string>;
  /** The same content there under another name: linked to that file (copied where the disk has no
   *  hard links), not unpacked. */
  link: Map<string, string>;
  /** There with other content (the two libraries fetched different files under one name). */
  clash: string[];
}

/** Whether `file` holds `want` (the media index's word for it when it has one of that size). */
async function holds(
  fs: DataFs,
  file: string,
  want: { sha256: string; size: number },
  known?: string,
) {
  const stat = fs.stat(file);
  if (!stat || stat.dir || stat.size !== want.size) return false;
  return (known ?? (await hashFile(fs, file)).sha256) === want.sha256;
}

/**
 * What to unpack of a bundle: every library file; a media file or source copy only when the series
 * does not hold it already — the same content under its name is skipped, under another name of the
 * media index linked. A media file the importer made (`madeByImporter`) there with other content, the
 * bundle's and the series' media index naming it by the same address, is the same part of the same
 * document made by another version: ours is kept. Any other media file or source copy there with
 * other content is a clash (the bundle cannot be installed): nothing of the library is replaced by a
 * bundle but the course's own folders.
 */
export async function planBundle(
  fs: DataFs,
  libraryRoot: string,
  manifest: CourseBundleManifest,
): Promise<BundlePlan> {
  const seriesDir = joinPath(libraryRoot, bundleSeries(manifest));
  const { media } = await seriesState(fs, seriesDir);
  const byPath = new Map<string, { sha256: string; size: number; url: string }>();
  const byHash = new Map<string, string>();
  for (const [url, e] of Object.entries(media))
    if ("path" in e) {
      byPath.set(e.path, { ...e, url });
      byHash.set(e.sha256, e.path);
    }
  /** The bundle's media file of `path` made by the importer from the same address as ours. */
  const remade = (path: string) => {
    const ours = byPath.get(path);
    const theirs = ours && manifest.media[ours.url];
    return !!theirs && madeByImporter(ours.url) && "path" in theirs && theirs.path === path;
  };
  const plan: BundlePlan = {
    unpack: new Set(),
    skip: new Set(),
    keep: new Set(),
    link: new Map(),
    clash: [],
  };
  for (const f of manifest.files) {
    if (isLibraryJson(f.path)) {
      plan.unpack.add(f.path);
      continue;
    }
    const file = joinPath(seriesDir, f.path);
    const known = byPath.get(f.path);
    if (await holds(fs, file, f, known?.size === f.size ? known.sha256 : undefined)) {
      plan.skip.add(f.path);
      continue;
    }
    const isMedia = f.path.startsWith("media/");
    const there = fs.stat(file);
    if (there && isMedia && !there.dir && remade(f.path)) {
      plan.keep.add(f.path);
      continue;
    }
    if (there) {
      plan.clash.push(f.path);
      continue;
    }
    // The file linked to is hashed: the index says what it held when it was fetched, and a link
    // makes the bundle's name hold whatever it holds now.
    const other = isMedia ? byHash.get(f.sha256) : undefined;
    if (other && (await holds(fs, joinPath(seriesDir, other), f))) plan.link.set(f.path, other);
    else plan.unpack.add(f.path);
  }
  return plan;
}

/** The series a bundle's courses are of (the manifest's schema has them of one). */
export const bundleSeries = (manifest: CourseBundleManifest) => {
  const key = manifest.courses[0]?.course ?? "";
  return key.slice(0, key.indexOf("/"));
};

/** Whether two of the paths are one file on a disk that does not tell case or Unicode forms apart
 *  (APFS, NTFS): the second would be written over the first. */
export function aliased(paths: readonly string[]) {
  return new Set(paths.map((p) => p.normalize("NFC").toLowerCase())).size !== paths.length;
}

/** A library file's schema and the path its value says it has (libraryFile), by its kind. */
function kindOf(path: string): {
  schema: z.ZodType;
  file: (value: never) => LibraryFile;
} {
  if (isPracticeJson(path)) return { schema: PracticeLesson, file: libraryFile.practice };
  const locale = path.startsWith("locale/");
  if (path.endsWith("/course.json"))
    return locale
      ? { schema: LocaleCourse, file: libraryFile.localeCourse }
      : { schema: CourseIndex, file: libraryFile.course };
  if (path.includes("/lessons/"))
    return locale
      ? { schema: LocaleLesson, file: libraryFile.localeLesson }
      : { schema: Lesson, file: libraryFile.lesson };
  if (path.includes("/sources/")) return { schema: ExamSources, file: libraryFile.examSources };
  return locale
    ? { schema: LocaleExam, file: libraryFile.localeExam }
    : { schema: Exam, file: libraryFile.exam };
}

/** The course and edition a library file's value is of. */
function ownerOf(value: Record<string, unknown>): { course: string; edition?: string } {
  const key = String(value.course ?? value.key ?? value.lesson ?? value.exam ?? "");
  const parts = key.split("/");
  return {
    course: parts.slice(0, 2).join("/"),
    edition: typeof value.edition === "string" ? value.edition : undefined,
  };
}

/**
 * A bundle unpacked into `files` (series paths) checked before anything of it is installed: each
 * library file reads by its schema (strict: a field it does not know is an error), lies where its own
 * keys put it, and is of one of the bundle's courses and that course's editions; each course's index
 * and each of its editions' course files are there; every media file is one the files name, every
 * source copy one an exam's sources name; the media index's lines are of media it holds and the key
 * map's of scopes under its courses. Returns the problems found (the first few).
 */
export async function checkBundle(fs: DataFs, files: string, manifest: CourseBundleManifest) {
  const problems: string[] = [];
  const courses = new Map<string, (typeof manifest.courses)[number]>(
    manifest.courses.map((c) => [c.course, c]),
  );
  const ids = new Set(manifest.courses.map((c) => courseIdOf(c.course)));
  const named = new Set<string>();
  const raw = new Set<string>();
  const recorded = new Set<string>();
  const paths = new Set(manifest.files.map((f) => f.path));
  for (const path of paths) {
    if (problems.length >= 20) break;
    if (!isLibraryJson(path)) continue;
    let value: unknown;
    try {
      value = await readJson(fs, joinPath(files, path));
    } catch {
      problems.push(`${path}: not JSON`);
      continue;
    }
    const kind = kindOf(path);
    const parsed = kind.schema.safeParse(value);
    if (!parsed.success) {
      problems.push(`${path}: does not fit its schema`);
      continue;
    }
    const owner = ownerOf(parsed.data as Record<string, unknown>);
    const course = courses.get(owner.course);
    if (
      kind.file(parsed.data as never).path !== path ||
      !course ||
      ((path.startsWith("locale/") || isPracticeJson(path)) &&
        !course.editions.includes(owner.edition ?? ""))
    ) {
      problems.push(`${path}: not where its keys put it in the bundle's courses`);
      continue;
    }
    if (isPracticeJson(path)) {
      for (const r of practiceRecordings(parsed.data as PracticeLesson)) recorded.add(r);
      continue;
    }
    mediaPaths(parsed.data, named);
    if (path.includes("/sources/"))
      for (const d of (parsed.data as ExamSources).documents) if (d.raw) raw.add(d.raw);
  }
  for (const c of manifest.courses) {
    const id = courseIdOf(c.course);
    const required = [
      `canonical/${id}/course.json`,
      ...c.editions.map((e) => `locale/${e}/${id}/course.json`),
    ];
    for (const path of required) if (!paths.has(path)) problems.push(`${path}: missing`);
  }
  for (const path of paths) {
    if (path.startsWith("media/") && !named.has(path))
      problems.push(`${path}: a media file its courses do not use`);
    const of = bundlePathCourse(path);
    if (of !== undefined && !ids.has(of)) problems.push(`${path}: not of the bundle's courses`);
    if (path.startsWith("raw/") && !raw.has(path))
      problems.push(`${path}: a copy no exam's sources name`);
    if (path.startsWith("practice/") && !isPracticeJson(path) && !recorded.has(path))
      problems.push(`${path}: a recording no practice names`);
  }
  // A line of media.json is believed by the next download of the series (a URL stored is not
  // fetched again): each says what the bundle holds — its file, of its kind, size and content — of
  // an address on the web.
  const listed = new Map(manifest.files.map((f) => [f.path, f]));
  for (const [url, entry] of Object.entries(manifest.media)) {
    const file = "path" in entry ? listed.get(entry.path) : undefined;
    if (
      !("path" in entry) ||
      !file ||
      !entry.path.startsWith(`media/${entry.kind}/`) ||
      entry.sha256 !== file.sha256 ||
      entry.size !== file.size ||
      !/^https?:$/.test(URL.parse(url)?.protocol ?? "")
    )
      problems.push(`media.json ${url}: not a media file of the bundle as listed`);
  }
  for (const scope of Object.keys(manifest.keys))
    if (!manifest.courses.some((c) => scope.startsWith(`${c.course}/`)))
      problems.push(`keys.json ${scope}: not a scope of the bundle's courses`);
  // Its content versions are those of its files (each hashed as it was unpacked): "the same" is
  // believed only so.
  for (const c of manifest.courses) {
    const versions = contentVersions(courseIdOf(c.course), c.editions, manifest.files);
    if (
      versions.canonical !== c.content.canonical ||
      sorted(versions.practice) !== sorted(c.content.practice) ||
      Object.keys(c.content.editions).sort().join() !== [...c.editions].sort().join() ||
      c.editions.some((e) => versions.editions[e] !== c.content.editions[e])
    )
      problems.push(`manifest: content versions of ${c.course} not those of its files`);
  }
  return problems.slice(0, 20);
}

/** A record's entries in key order, as text: two records compared whatever order they were made in. */
const sorted = (record: Record<string, string> | undefined) =>
  JSON.stringify(Object.entries(record ?? {}).sort());

/** Moves a file or folder into place, its folder made first. */
function moveInto(fs: DataFs, from: string, to: string) {
  fs.mkdir(dirName(to));
  fs.rename(from, to);
}

/** What an install is changing, written in `aside` before it changes anything and removed once it is
 *  done: an install the process stopped in the middle of is undone by it (`undoInstall`). */
const JOURNAL = "install.json";
interface InstallJournal {
  series: string;
  /** Media and source copies placed: none was there before. */
  placed: string[];
  /** The courses' folders replaced (`had`: there before; the old one kept aside). */
  folders: Array<{ prefix: string; had: boolean }>;
  /** The series' files it rewrites (media.json, keys.json): each kept aside as it was, if it was. */
  state: string[];
  /** Lessons' practice it merges into (`had`: there before; the old one kept aside). */
  practice: Array<{ path: string; had: boolean }>;
}

/** How many variants a lesson's practice holds. */
const variants = (p: PracticeLesson | undefined) =>
  p ? p.reading.length + p.listening.length + p.writing.length + p.speaking.length : 0;

/**
 * A checked bundle, unpacked into `files`, installed into the library — the caller holds the series'
 * import lock. First what must hold is checked again (the library may have changed since the plan):
 * nothing of it is changed before. Then, all or nothing: its media and source copies moved (or
 * linked) into place, its courses' folders — canonical and each edition's — replaced whole where
 * their content version differs, and last the series' media index given the lines it lacks and the
 * key map its courses' scopes (replaced: the bundle's are the courses'); each lesson's practice merged
 * with the one here — every variant of either, each once, so variants made on two machines gather.
 * What it changes is written to
 * `aside` first, with the old folders and files kept there: an error midway undoes it here, a process
 * stopped midway is undone by `undoInstall` (the server's start). Other editions of a course stay as
 * they are. Each course: `same` when nothing of its content differed, `added` when it was not here,
 * else `replaced`; and the practice variants it brought that were not here.
 */
export async function installBundle(options: {
  fs: DataFs;
  libraryRoot: string;
  files: string;
  aside: string;
  manifest: CourseBundleManifest;
  plan: BundlePlan;
}) {
  const { fs, manifest, plan, files, aside, libraryRoot } = options;
  const series = bundleSeries(manifest);
  const seriesDir = joinPath(libraryRoot, series);
  const listed = new Map(manifest.files.map((f) => [f.path, f]));
  // What must hold, checked again before anything changes: the files the plan found still there, of
  // their size (their content was found then; a stored name keeps its content) — a file linked
  // to hashed again (`hashed`).
  const still = (path: string, file: string, hashed = false) => {
    const want = listed.get(path) as { sha256: string; size: number };
    return holds(fs, joinPath(seriesDir, file), want, hashed ? undefined : want.sha256);
  };
  for (const path of plan.skip)
    if (!(await still(path, path))) throw new Error(`${path} changed in the library meanwhile`);
  for (const path of plan.keep)
    if (!fs.stat(joinPath(seriesDir, path))) throw new Error(`${path} left the library meanwhile`);
  for (const [path, from] of plan.link)
    if (fs.stat(joinPath(seriesDir, path)) || !(await still(path, from, true)))
      throw new Error(`${path} changed in the library meanwhile`);
  for (const path of plan.unpack)
    if (!isLibraryJson(path) && fs.stat(joinPath(seriesDir, path)))
      throw new Error(`${path} came into the library meanwhile`);
  const state = await seriesState(fs, seriesDir);
  const courses = [];
  for (const c of manifest.courses) {
    const id = courseIdOf(c.course);
    const before = await installedVersions(fs, seriesDir, id, c.editions);
    const folders = [
      { prefix: `canonical/${id}`, was: before.canonical, now: c.content.canonical },
      ...c.editions.map((e) => ({
        prefix: `locale/${e}/${id}`,
        was: before.editions[e] ?? null,
        now: c.content.editions[e],
      })),
    ];
    courses.push({ course: c.course, had: !!before.canonical, folders });
  }

  // The series' own state: lines it lacks (or whose file failed) from the bundle; the course's scopes.
  const media = { ...state.media };
  for (const [url, entry] of Object.entries(manifest.media)) {
    const known = media[url];
    if (!known || !("path" in known)) media[url] = entry;
  }
  const others = Object.entries(state.keys).filter(
    ([scope]) => !manifest.courses.some((c) => scope.startsWith(`${c.course}/`)),
  );
  const keys = { ...Object.fromEntries(others), ...manifest.keys };
  const rewrites = [
    { name: "media.json", value: media, was: state.media },
    { name: "keys.json", value: keys, was: state.keys },
  ].filter((r) => JSON.stringify(r.value) !== JSON.stringify(r.was));
  const changed = courses.flatMap((c) => c.folders.filter((f) => f.was !== f.now));
  const placed = [...[...plan.unpack].filter((p) => !isLibraryJson(p)), ...plan.link.keys()];
  // Each lesson's practice merged with the one here; the variants it brings, by course.
  const practice: Array<{ path: string; had: boolean; value: PracticeLesson }> = [];
  const brought = new Map<string, number>();
  for (const f of manifest.files) {
    if (!isPracticeJson(f.path)) continue;
    const theirs = PracticeLesson.parse(await readJson(fs, joinPath(files, f.path)));
    const target = joinPath(seriesDir, f.path);
    const ours = fs.stat(target)
      ? PracticeLesson.safeParse(await readJson(fs, target)).data
      : undefined;
    const value = ours ? mergePractice(ours, theirs) : theirs;
    const added = variants(value) - variants(ours);
    if (!added && ours) continue;
    practice.push({ path: f.path, had: !!ours, value });
    const course = `${series}/${bundlePathCourse(f.path)}`;
    brought.set(course, (brought.get(course) ?? 0) + added);
  }

  // What it changes, first; the series' files as they were kept beside it.
  const kept = joinPath(aside, series);
  fs.mkdir(kept);
  for (const r of rewrites)
    if (fs.stat(joinPath(seriesDir, r.name)))
      fs.copy(joinPath(seriesDir, r.name), joinPath(kept, r.name));
  const journal: InstallJournal = {
    series,
    placed,
    folders: changed.map((f) => ({
      prefix: f.prefix,
      had: !!fs.stat(joinPath(seriesDir, f.prefix)),
    })),
    state: rewrites.map((r) => r.name),
    practice: practice.map(({ path, had }) => ({ path, had })),
  };
  for (const p of practice)
    if (p.had) {
      fs.mkdir(dirName(joinPath(kept, p.path)));
      fs.copy(joinPath(seriesDir, p.path), joinPath(kept, p.path));
    }
  await writeFileAtomic(fs, joinPath(aside, JOURNAL), JSON.stringify(journal));
  try {
    for (const path of plan.unpack)
      if (!isLibraryJson(path)) moveInto(fs, joinPath(files, path), joinPath(seriesDir, path));
    for (const [path, from] of plan.link) {
      fs.mkdir(dirName(joinPath(seriesDir, path)));
      linkOrCopy(fs, joinPath(seriesDir, from), joinPath(seriesDir, path));
    }
    for (const f of journal.folders) {
      const target = joinPath(seriesDir, f.prefix);
      if (f.had) moveInto(fs, target, joinPath(kept, f.prefix));
      moveInto(fs, joinPath(files, f.prefix), target);
    }
    for (const p of practice) {
      fs.mkdir(dirName(joinPath(seriesDir, p.path)));
      await writeFileAtomic(fs, joinPath(seriesDir, p.path), prettyJson(p.value));
    }
    for (const r of rewrites)
      await writeFileAtomic(
        fs,
        joinPath(seriesDir, r.name),
        `${JSON.stringify(r.value, null, 1)}\n`,
      );
  } catch (error) {
    undoInstall(fs, libraryRoot, aside);
    throw error;
  }
  // Done: what was kept aside goes.
  fs.remove(joinPath(aside, JOURNAL));
  fs.remove(aside);
  const unpackedMedia = [...plan.unpack].filter((p) => p.startsWith("media/")).length;
  return {
    courses: courses.map((c) => ({
      course: c.course,
      status: !c.had
        ? ("added" as const)
        : c.folders.some((f) => f.was !== f.now)
          ? ("replaced" as const)
          : ("same" as const),
      /** Practice variants it brought that were not here. */
      variants: brought.get(c.course) ?? 0,
    })),
    /** Media files placed (unpacked or linked), and those the library had already. */
    media: { added: unpackedMedia + plan.link.size, kept: plan.skip.size + plan.keep.size },
  };
}

/** The series an install that `aside` is the transfer folder of was changing, if it was stopped
 *  before it was done. */
export function installing(fs: DataFs, aside: string): string | undefined {
  const file = joinPath(aside, JOURNAL);
  return fs.stat(file) ? (JSON.parse(fs.readText(file) ?? "") as InstallJournal).series : undefined;
}

/**
 * An install stopped midway (`aside` its transfer's folder for it) undone — the caller holds the
 * series' import lock: the media and copies it placed removed, the course's folders it replaced put
 * back (those it added removed), the series' files it rewrote as they were. Without its journal (it
 * was done, or an older app's): course folders left aside put back where nothing took their place.
 */
export function undoInstall(fs: DataFs, libraryRoot: string, aside: string) {
  const file = joinPath(aside, JOURNAL);
  if (!fs.stat(file)) return restoreAside(fs, libraryRoot, aside);
  const journal = JSON.parse(fs.readText(file) ?? "") as InstallJournal;
  if (!SeriesKey.safeParse(journal.series).success) throw new Error(`${file}: no series`);
  const seriesDir = joinPath(libraryRoot, journal.series);
  const kept = joinPath(aside, journal.series);
  for (const path of journal.placed) fs.remove(joinPath(seriesDir, path));
  for (const f of journal.folders) {
    const target = joinPath(seriesDir, f.prefix);
    const old = joinPath(kept, f.prefix);
    // A folder it had not moved aside yet is the old one still.
    if (f.had && !fs.stat(old)) continue;
    fs.remove(target);
    if (f.had) moveInto(fs, old, target);
  }
  for (const p of journal.practice ?? []) {
    const old = joinPath(kept, p.path);
    if (p.had && fs.stat(old)) fs.rename(old, joinPath(seriesDir, p.path));
    else if (!p.had) fs.remove(joinPath(seriesDir, p.path));
  }
  for (const name of journal.state) {
    const old = joinPath(kept, name);
    if (fs.stat(old)) fs.rename(old, joinPath(seriesDir, name));
    else fs.remove(joinPath(seriesDir, name));
  }
  fs.remove(file);
}

/** Course folders left in `aside` (`<aside>/<series>/<folder>`) put back where nothing took their
 *  place. */
function restoreAside(fs: DataFs, libraryRoot: string, aside: string) {
  const dirs = (dir: string) => fs.list(dir);
  for (const series of dirs(aside).filter((s) => SeriesKey.safeParse(s).success)) {
    const base = joinPath(aside, series);
    const prefixes = [
      ...dirs(joinPath(base, "canonical")).map((c) => `canonical/${c}`),
      ...dirs(joinPath(base, "locale")).flatMap((e) =>
        dirs(joinPath(base, "locale", e)).map((c) => `locale/${e}/${c}`),
      ),
    ];
    for (const prefix of prefixes) {
      const target = joinPath(libraryRoot, series, prefix);
      if (!fs.stat(target)) moveInto(fs, joinPath(base, prefix), target);
    }
  }
}
