// Course bundles, the library's side (02, "Course bundle"): what a course's bundle holds — its library
// files of the editions asked, the media they use, its exams' source copies, its lines of media.json
// and keys.json, its content versions —, and a bundle unpacked beside the library checked and
// installed into it. Zips and transfer folders are the server's; a bundle is untrusted input, so every
// file is checked here before anything of it is moved into place.
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
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
  SeriesKey,
  Slug,
} from "@sprachanker/schema";
import type { z } from "zod";
import { hashFile, writeFileAtomic } from "./files.ts";
import { NotInstalledError, openLibrary } from "./library.ts";
import { type LibraryFile, libraryFile } from "./provider.ts";
import { mediaPaths } from "./verify.ts";

/** A file a bundle holds: its path in the series folder, and where it is on disk. */
export interface BundleFile {
  path: string;
  file: string;
}

/** A bundle's library JSON files: what the content versions and the schema checks cover. */
const isLibraryJson = (path: string) => path.startsWith("canonical/") || path.startsWith("locale/");

/** Paths of the files under `dir` (a course's folder), as series paths under `prefix`, that a bundle
 *  may hold (a temporary file an import left is none). */
function filesUnder(seriesDir: string, prefix: string) {
  const dir = join(seriesDir, prefix);
  if (!existsSync(dir)) return [];
  return (readdirSync(dir, { recursive: true, withFileTypes: true }) as import("node:fs").Dirent[])
    .filter((d) => d.isFile())
    .map((d) => `${prefix}/${join(d.parentPath.slice(dir.length), d.name).replace(/^\//, "")}`)
    .filter((path) => CourseBundlePath.safeParse(path).success)
    .sort();
}

/** The editions of a course installed in a series folder. */
function installedEditions(seriesDir: string, courseId: string) {
  const locale = join(seriesDir, "locale");
  return (existsSync(locale) ? readdirSync(locale) : [])
    .filter((e) => EditionId.safeParse(e).success)
    .filter((e) => existsSync(join(locale, e, courseId, "course.json")))
    .sort();
}

const readJson = async (file: string): Promise<unknown> => JSON.parse(await readFile(file, "utf8"));

/** A series' media index and key map, as stored (none yet: empty); one that does not read throws. */
async function seriesState(seriesDir: string) {
  const read = async (name: string) => {
    const file = join(seriesDir, name);
    return existsSync(file) ? await readJson(file) : {};
  };
  return {
    media: MediaIndex.parse(await read("media.json")),
    keys: KeyMapFile.parse(await read("keys.json")),
  };
}

/**
 * What a course's bundle holds (`editions`: those asked, else every one installed): its canonical
 * files, each edition's locale files, the media they name that are on disk, the copies its exams were
 * read from, its lines of the series' media index (those of the media it holds) and key map (the
 * scopes under the course). NotInstalledError when the course or an edition asked is not here.
 */
export async function courseBundleContent(
  libraryRoot: string,
  series: string,
  courseId: string,
  editions?: string[],
) {
  if (!SeriesKey.safeParse(series).success || !Slug.safeParse(courseId).success)
    throw new NotInstalledError(`${series}/${courseId}`);
  const library = openLibrary(libraryRoot);
  const seriesDir = join(libraryRoot, series);
  const index = await library.courseIndex(series, courseId);
  const installed = installedEditions(seriesDir, courseId);
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
    ...filesUnder(seriesDir, `canonical/${courseId}`),
    ...chosen.flatMap((e) => filesUnder(seriesDir, `locale/${e}/${courseId}`)),
  ];
  // What the files name: media, and the copies an exam was read from.
  const named = new Set<string>();
  const raw = new Set<string>();
  for (const path of json) {
    const value = await readJson(join(seriesDir, path));
    mediaPaths(value, named);
    if (path.includes("/sources/"))
      for (const d of ExamSources.safeParse(value).data?.documents ?? []) if (d.raw) raw.add(d.raw);
  }
  const present = (paths: Set<string>, fileOf: (path: string) => string | undefined) =>
    [...paths]
      .sort()
      .filter((path) => CourseBundlePath.safeParse(path).success)
      .flatMap((path) => {
        const file = fileOf(path);
        return file ? [{ path, file }] : [];
      });
  const media = present(named, (p) => library.mediaFile(series, p));
  const copies = present(raw, (p) => library.rawFile(series, p));
  const state = await seriesState(seriesDir);
  const held = new Set(media.map((m) => m.path));
  const prefix = `${index.key}/`;
  const lessons = index.units.some((u) => u.lessons.length);
  return {
    course: index.key,
    kind: !lessons && index.exams.length ? ("exam" as const) : ("course" as const),
    editions: chosen,
    source: index.source ?? null,
    titles,
    media: Object.fromEntries(
      Object.entries(state.media).filter(([, e]) => "path" in e && held.has(e.path)),
    ) as MediaIndex,
    keys: Object.fromEntries(
      Object.entries(state.keys).filter(([scope]) => scope.startsWith(prefix)),
    ) as KeyMapFile,
    files: [...json.map((path) => ({ path, file: join(seriesDir, path) })), ...media, ...copies],
  };
}
export type CourseBundleContent = Awaited<ReturnType<typeof courseBundleContent>>;

/** A content version: a sha256 over the files' paths and hashes, in path order. */
function versionOf(files: ReadonlyArray<{ path: string; sha256: string }>) {
  const hash = createHash("sha256");
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : 1)))
    hash.update(`${f.path} ${f.sha256}\n`);
  return hash.digest("hex");
}

/** A course's content versions from its files (02, "Manifest"): of its canonical files, and of each
 *  edition's locale files. */
export function contentVersions(
  courseId: string,
  editions: readonly string[],
  files: ReadonlyArray<{ path: string; sha256: string }>,
) {
  const of = (prefix: string) => versionOf(files.filter((f) => f.path.startsWith(prefix)));
  return {
    canonical: of(`canonical/${courseId}/`),
    editions: Object.fromEntries(editions.map((e) => [e, of(`locale/${e}/${courseId}/`)])),
  };
}

/** The content versions of a course as installed (null where a folder is not there). */
async function installedVersions(seriesDir: string, courseId: string, editions: string[]) {
  const of = async (prefix: string) => {
    if (!existsSync(join(seriesDir, prefix, "course.json"))) return null;
    const files = [];
    for (const path of filesUnder(seriesDir, prefix))
      files.push({ path, sha256: (await hashFile(join(seriesDir, path))).sha256 });
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
  /** The same content there under another name: linked to that file (copied where the disk has no
   *  hard links), not unpacked. */
  link: Map<string, string>;
  /** There with other content (the two libraries fetched different files under one name). */
  clash: string[];
}

/** Whether `file` holds `want` (the media index's word for it when it has one of that size). */
async function holds(file: string, want: { sha256: string; size: number }, known?: string) {
  const stat = statSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size !== want.size) return false;
  return (known ?? (await hashFile(file)).sha256) === want.sha256;
}

/**
 * What to unpack of a bundle: every library file; a media file or source copy only when the series
 * does not hold it already — the same content under its name is skipped, under another name of the
 * media index linked. A media file there with other content is a clash (the bundle cannot be
 * installed); a source copy there with other content is replaced (the exam's sources name the one
 * they were read from).
 */
export async function planBundle(
  libraryRoot: string,
  manifest: CourseBundleManifest,
): Promise<BundlePlan> {
  const seriesDir = join(libraryRoot, courseSeries(manifest));
  const { media } = await seriesState(seriesDir);
  const byPath = new Map<string, { sha256: string; size: number }>();
  const byHash = new Map<string, string>();
  for (const e of Object.values(media))
    if ("path" in e) {
      byPath.set(e.path, e);
      byHash.set(e.sha256, e.path);
    }
  const plan: BundlePlan = { unpack: new Set(), skip: new Set(), link: new Map(), clash: [] };
  for (const f of manifest.files) {
    if (isLibraryJson(f.path)) {
      plan.unpack.add(f.path);
      continue;
    }
    const file = join(seriesDir, f.path);
    const known = byPath.get(f.path);
    if (await holds(file, f, known?.size === f.size ? known.sha256 : undefined)) {
      plan.skip.add(f.path);
      continue;
    }
    const isMedia = f.path.startsWith("media/");
    if (isMedia && existsSync(file)) {
      plan.clash.push(f.path);
      continue;
    }
    // The file linked to is hashed: the index says what it held when it was fetched, and a link
    // makes the bundle's name hold whatever it holds now.
    const other = isMedia ? byHash.get(f.sha256) : undefined;
    if (other && (await holds(join(seriesDir, other), f))) plan.link.set(f.path, other);
    else plan.unpack.add(f.path);
  }
  return plan;
}

const courseSeries = (manifest: CourseBundleManifest) =>
  manifest.course.slice(0, manifest.course.indexOf("/"));

/** A library file's schema and the path its value says it has (libraryFile), by its kind. */
function kindOf(path: string): {
  schema: z.ZodType;
  file: (value: never) => LibraryFile;
} {
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
 * keys put it, and is of the bundle's course and editions; the course's index and each edition's
 * course file are there; every media file is one the files name, every source copy one an exam's
 * sources name; the media index's lines are of media it holds and the key map's of scopes under the
 * course. Returns the problems found (the first few).
 */
export async function checkBundle(files: string, manifest: CourseBundleManifest) {
  const problems: string[] = [];
  const courseId = courseIdOf(manifest.course);
  const named = new Set<string>();
  const raw = new Set<string>();
  const paths = new Set(manifest.files.map((f) => f.path));
  for (const path of paths) {
    if (problems.length >= 20) break;
    if (!isLibraryJson(path)) continue;
    let value: unknown;
    try {
      value = await readJson(join(files, path));
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
    if (
      kind.file(parsed.data as never).path !== path ||
      owner.course !== manifest.course ||
      (path.startsWith("locale/") && !manifest.editions.includes(owner.edition ?? ""))
    ) {
      problems.push(`${path}: not where its keys put it in ${manifest.course}`);
      continue;
    }
    mediaPaths(parsed.data, named);
    if (path.includes("/sources/"))
      for (const d of (parsed.data as ExamSources).documents) if (d.raw) raw.add(d.raw);
  }
  const required = [
    `canonical/${courseId}/course.json`,
    ...manifest.editions.map((e) => `locale/${e}/${courseId}/course.json`),
  ];
  for (const path of required) if (!paths.has(path)) problems.push(`${path}: missing`);
  for (const path of paths) {
    if (path.startsWith("media/") && !named.has(path))
      problems.push(`${path}: a media file the course does not use`);
    if (path.startsWith("raw/") && !raw.has(path))
      problems.push(`${path}: a copy no exam's sources name`);
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
    if (!scope.startsWith(`${manifest.course}/`))
      problems.push(`keys.json ${scope}: not a scope of ${manifest.course}`);
  // Its content versions are those of its files (each hashed as it was unpacked): "the same" is
  // believed only so.
  const versions = contentVersions(courseId, manifest.editions, manifest.files);
  if (
    versions.canonical !== manifest.content.canonical ||
    Object.keys(manifest.content.editions).sort().join() !== [...manifest.editions].sort().join() ||
    manifest.editions.some((e) => versions.editions[e] !== manifest.content.editions[e])
  )
    problems.push("manifest: content versions not those of its files");
  return problems.slice(0, 20);
}

/** Moves a file or folder into place, its folder made first. */
function moveInto(from: string, to: string) {
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
}

/**
 * A checked bundle, unpacked into `files`, installed into the library — the caller holds the series'
 * import lock. First what must hold is checked again (the library may have changed since the plan):
 * nothing of it is changed before. Then: its media and source copies moved (or linked) into place,
 * the series' media index given the lines it lacks and the key map the course's scopes, and the
 * course's folders — canonical and each edition's — replaced whole where their content version
 * differs (the folder replaced is kept in `aside` until the new one is in place). Other editions of
 * the course stay as they are. `same` when nothing of its content differed, `added` when the course
 * was not here, else `replaced`.
 */
export async function installBundle(options: {
  libraryRoot: string;
  files: string;
  aside: string;
  manifest: CourseBundleManifest;
  plan: BundlePlan;
}) {
  const { manifest, plan, files, aside } = options;
  const seriesDir = join(options.libraryRoot, courseSeries(manifest));
  const courseId = courseIdOf(manifest.course);
  const listed = new Map(manifest.files.map((f) => [f.path, f]));
  // What must hold, checked again before anything changes: the files the plan found still there, of
  // their size (their content was found then; a stored name keeps its content, 02) — a file linked
  // to hashed again (`hashed`).
  const still = (path: string, file: string, hashed = false) => {
    const want = listed.get(path) as { sha256: string; size: number };
    return holds(join(seriesDir, file), want, hashed ? undefined : want.sha256);
  };
  for (const path of plan.skip)
    if (!(await still(path, path))) throw new Error(`${path} changed in the library meanwhile`);
  for (const [path, from] of plan.link)
    if (existsSync(join(seriesDir, path)) || !(await still(path, from, true)))
      throw new Error(`${path} changed in the library meanwhile`);
  for (const path of plan.unpack)
    if (path.startsWith("media/") && existsSync(join(seriesDir, path)))
      throw new Error(`${path} came into the library meanwhile`);
  const state = await seriesState(seriesDir);
  const before = await installedVersions(seriesDir, courseId, manifest.editions);

  // Media and source copies.
  for (const path of plan.unpack)
    if (!isLibraryJson(path)) moveInto(join(files, path), join(seriesDir, path));
  for (const [path, from] of plan.link) {
    mkdirSync(dirname(join(seriesDir, path)), { recursive: true });
    try {
      linkSync(join(seriesDir, from), join(seriesDir, path));
    } catch {
      copyFileSync(join(seriesDir, from), join(seriesDir, path));
    }
  }
  // The series' own state: lines it lacks (or whose file failed) from the bundle; the course's scopes.
  const media = { ...state.media };
  let mediaChanged = false;
  for (const [url, entry] of Object.entries(manifest.media)) {
    const known = media[url];
    if (known && "path" in known) continue;
    media[url] = entry;
    mediaChanged = true;
  }
  const others = Object.entries(state.keys).filter(
    ([scope]) => !scope.startsWith(`${manifest.course}/`),
  );
  const keys = { ...Object.fromEntries(others), ...manifest.keys };
  if (mediaChanged)
    await writeFileAtomic(join(seriesDir, "media.json"), `${JSON.stringify(media, null, 1)}\n`);
  if (JSON.stringify(keys) !== JSON.stringify(state.keys))
    await writeFileAtomic(join(seriesDir, "keys.json"), `${JSON.stringify(keys, null, 1)}\n`);

  // The course's folders, each replaced whole where it differs.
  const folders = [
    { prefix: `canonical/${courseId}`, was: before.canonical, now: manifest.content.canonical },
    ...manifest.editions.map((e) => ({
      prefix: `locale/${e}/${courseId}`,
      was: before.editions[e] ?? null,
      now: manifest.content.editions[e],
    })),
  ];
  const changed = folders.filter((f) => f.was !== f.now);
  const asideOf = (prefix: string) => join(aside, courseSeries(manifest), prefix);
  const moved: string[] = [];
  try {
    for (const f of changed) {
      const target = join(seriesDir, f.prefix);
      if (existsSync(target)) {
        moveInto(target, asideOf(f.prefix));
        moved.push(f.prefix);
      }
      moveInto(join(files, f.prefix), target);
    }
  } catch (error) {
    // Back as it was: the old folders into place again.
    for (const prefix of moved) {
      const target = join(seriesDir, prefix);
      if (existsSync(asideOf(prefix))) {
        rmSync(target, { recursive: true, force: true });
        renameSync(asideOf(prefix), target);
      }
    }
    throw error;
  }
  for (const prefix of moved) rmSync(asideOf(prefix), { recursive: true, force: true });
  const unpackedMedia = [...plan.unpack].filter((p) => p.startsWith("media/")).length;
  return {
    status: !before.canonical
      ? ("added" as const)
      : changed.length
        ? ("replaced" as const)
        : ("same" as const),
    /** Media files placed (unpacked or linked), and those the library had already. */
    media: { added: unpackedMedia + plan.link.size, kept: plan.skip.size },
  };
}

/** Course folders an install stopped midway left in `aside` (`<aside>/<series>/<folder>`) put back
 *  where nothing took their place. */
export function restoreAside(libraryRoot: string, aside: string) {
  const dirs = (dir: string) => (existsSync(dir) ? readdirSync(dir) : []);
  for (const series of dirs(aside).filter((s) => SeriesKey.safeParse(s).success)) {
    const base = join(aside, series);
    const prefixes = [
      ...dirs(join(base, "canonical")).map((c) => `canonical/${c}`),
      ...dirs(join(base, "locale")).flatMap((e) =>
        dirs(join(base, "locale", e)).map((c) => `locale/${e}/${c}`),
      ),
    ];
    for (const prefix of prefixes) {
      const target = join(libraryRoot, series, prefix);
      if (!existsSync(target)) moveInto(join(base, prefix), target);
    }
  }
}
