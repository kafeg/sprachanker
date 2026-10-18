// Downloaded courses — or exams — moved between one's own machines, or kept aside, as files (course
// bundles): exported — one course (the app's), or a series' courses grouped so no media file is in
// two bundles (a course in several languages one file, its videos once) —, each its courses' files of
// the editions asked, the media they use, a manifest with a hash per file, streamed as a zip; and
// imported: every file checked against the manifest and by its schema before anything is moved into
// place, media the library holds not unpacked again, each course replaced where its content differs,
// all or nothing, then verified. The files themselves are the runtime's (CourseTransferFiles).
import {
  COURSE_BUNDLE_EXTENSION,
  COURSE_BUNDLE_FORMAT,
  COURSE_BUNDLE_MAX_BYTES,
  COURSE_BUNDLE_VERSION,
  type CourseBundleCourse,
  CourseBundleManifest,
  type CourseKey,
  courseBundleVersion,
  courseIdOf,
  type KeyMapFile,
  type MediaIndex,
  seriesOf,
} from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import { createOnce } from "../once.ts";
import { guarded, oneAtATime, preparedExports } from "./transfers.ts";

/** A file of a bundle besides its manifest, as listed in the manifest. */
export interface BundleFileEntry {
  path: string;
  size: number;
  sha256: string;
}

/** What an export holds, made ready in a transfer (the manifest's parts the runtime knows). */
export interface StagedBundle {
  id: string;
  courses: CourseBundleCourse[];
  provider: string | null;
  media: MediaIndex;
  keys: KeyMapFile;
  files: BundleFileEntry[];
}

/** A bundle installed: each course new, the same or replaced, and what `verify` found of it; the
 *  media placed and kept. */
export interface InstalledBundle {
  courses: Array<{
    course: CourseKey;
    status: "added" | "same" | "replaced";
    check: { problems: number; missing: number };
  }>;
  media: { added: number; kept: number };
}

/**
 * Course bundles on disk (runtime adapter): each export or import works in a transfer folder of its
 * own (`library/.transfers/<id>/`), removed when it ends. A full disk is an error with code `ENOSPC`.
 */
export interface CourseTransferFiles {
  /** Transfers an hour old go (an install one stopped midway undone first). */
  sweep(): void;
  /** Installs stopped midway (the process stopped) undone, whatever their age, each under its
   *  series' lock (one another process holds is its install, running). */
  recover(): Promise<void>;
  /** Courses' files of one series (`editions`: those asked of each, else every one installed) made
   *  ready in a new transfer, each hashed — those an import rewrites in place linked or copied there,
   *  media and recordings read from the library when streamed; NotInstalledError when a course or an
   *  edition is not here. */
  stage(series: string, courses: string[], editions?: string[]): Promise<StagedBundle>;
  /** Every installed course by series, grouped so courses naming one media file are one group. */
  groups(): Promise<Array<{ series: string; courses: string[] }>>;
  /** The length of the bundle `stream` makes. */
  bytes(id: string, manifest: string, paths: string[]): number;
  /** A course made ready as a bundle: `manifest.json` first, then its files in the order given, each
   *  read as it is streamed (one changed since it was hashed fails the stream); the transfer goes
   *  when the stream ends or is cancelled. */
  stream(id: string, manifest: string, paths: string[]): ReadableStream<Uint8Array>;
  /** A stream written whole to a file (beside it, then renamed), its disk checked for `bytes` first. */
  save(stream: ReadableStream<Uint8Array>, file: string, bytes: number): Promise<void>;
  /** A new, empty transfer. */
  begin(): string;
  /** A bundle begun to be read as it comes — an upload of `length` bytes (more: an error, code EFBIG;
   *  one that stalls: ETIMEDOUT), or a file —: its manifest's text, the zip's first entry; undefined
   *  when it does not begin as a zip of stored entries with its manifest first. */
  read(
    id: string,
    from: { body: AsyncIterable<Uint8Array>; length: number } | { file: string },
  ): Promise<string | undefined>;
  /** The rest of the bundle `read` began, as it comes: what the library lacks written into the
   *  transfer, hashed; "damaged" at the first file not listed once with its size, or not as listed,
   *  or a file listed that never came; "clash" when a media file the library has under its name holds
   *  other content (nothing written); "not_a_bundle" when the zip is not one as written here (its
   *  directory not its entries, paths a bundle may not hold, two names one file). */
  unpack(
    id: string,
    manifest: CourseBundleManifest,
  ): Promise<"ok" | "damaged" | "clash" | "not_a_bundle">;
  /** The unpacked files checked by their schemas and places: the problems found. */
  check(id: string, manifest: CourseBundleManifest): Promise<string[]>;
  /** The checked bundle installed under its series' lock, then verified. */
  install(id: string, manifest: CourseBundleManifest): Promise<InstalledBundle>;
  discard(id: string): void;
}

export function createCourseTransfer(deps: {
  files: CourseTransferFiles;
  appVersion: string;
  now: () => number;
  /** Called when courses were installed from a bundle: their files may have changed. */
  onInstalled?: (courses: Array<{ series: string; course: string }>) => void;
}) {
  const { files, now } = deps;
  /** Exports made ready: the server's (any profile may download one by its id). */
  const prepared = preparedExports<{
    manifest: string;
    paths: string[];
    fileName: string;
    bytes: number;
  }>(files.discard, "course_export_gone");
  const SERVER = "server";
  // At the start: an install a stopped process left midway undone, whatever its age (each export
  // and import waits for it); a stopped server's transfers.
  const recovered = files.recover();
  files.sweep();
  /** An import, the only one while it runs (each needs the room of its file and more). */
  const alone = oneAtATime("course_import_busy");

  /** The upload or the file read as it comes, checked, unpacked and installed; the transfer is the
   *  caller's to discard. */
  async function settle(
    id: string,
    from: { body: AsyncIterable<Uint8Array>; length: number } | { file: string },
  ) {
    const text = await files.read(id, from);
    if (text === undefined) throw new ServiceError("not_a_course_bundle", 422);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ServiceError("not_a_course_bundle", 422);
    }
    const format = (json as { format?: unknown } | null)?.format;
    const version = (json as { version?: unknown } | null)?.version;
    if (format !== COURSE_BUNDLE_FORMAT) throw new ServiceError("not_a_course_bundle", 422);
    if (typeof version === "number" && version > COURSE_BUNDLE_VERSION)
      throw new ServiceError("course_bundle_from_newer_app", 422);
    const parsed = CourseBundleManifest.safeParse(json);
    if (!parsed.success) throw new ServiceError("not_a_course_bundle", 422);
    const manifest = parsed.data;
    // Each file listed once (the zip's entries are checked against the list as they come).
    if (new Set(manifest.files.map((f) => f.path)).size !== manifest.files.length)
      throw new ServiceError("course_bundle_damaged", 422);
    const unpacked = await files.unpack(id, manifest);
    if (unpacked === "clash") throw new ServiceError("course_bundle_clash", 409);
    if (unpacked === "damaged") throw new ServiceError("course_bundle_damaged", 422);
    if (unpacked === "not_a_bundle") throw new ServiceError("not_a_course_bundle", 422);
    const problems = await files.check(id, manifest);
    if (problems.length) {
      const of = manifest.courses.map((c) => c.course).join(", ");
      console.error(`a course bundle of ${of} refused:\n  ${problems.join("\n  ")}`);
      throw new ServiceError("course_bundle_damaged", 422);
    }
    const installed = await files.install(id, manifest);
    deps.onInstalled?.(
      manifest.courses.map((c) => ({ series: seriesOf(c.course), course: courseIdOf(c.course) })),
    );
    const done = new Map(installed.courses.map((c) => [c.course, c]));
    return {
      courses: manifest.courses.map((c) => ({
        key: c.course,
        kind: c.kind,
        editions: c.editions,
        titles: c.titles,
        status: done.get(c.course)?.status ?? ("same" as const),
        check: done.get(c.course)?.check ?? { problems: 0, missing: 0 },
      })),
      media: installed.media,
    };
  }

  /** The export made ready of each set of courses (`<series>/<course>,…`), as asked (their editions,
   *  or "" for all): one a set, while it waits to be downloaded. */
  const byCourse = new Map<string, { asked: string; ready: ReturnType<typeof keep> }>();
  const staging = createOnce<ReturnType<typeof keep>>();

  /** A staged bundle made a prepared export: its manifest, file name and size. */
  function keep(staged: StagedBundle) {
    const paths = staged.files.map((f) => f.path);
    const manifest = JSON.stringify({
      format: COURSE_BUNDLE_FORMAT,
      version: courseBundleVersion(paths),
      appVersion: deps.appVersion,
      exportedAt: now(),
      courses: staged.courses,
      provider: staged.provider,
      media: staged.media,
      keys: staged.keys,
      files: staged.files,
    } satisfies CourseBundleManifest);
    const bytes = files.bytes(staged.id, manifest, paths);
    if (bytes > COURSE_BUNDLE_MAX_BYTES) throw new ServiceError("course_bundle_too_large", 422);
    const fileName = bundleName(staged.courses, new Date(now()).toISOString().slice(0, 10));
    prepared.keep(staged.id, SERVER, { manifest, paths, fileName, bytes });
    return {
      id: staged.id,
      fileName,
      bytes,
      courses: staged.courses.map((c) => ({ course: c.course, editions: c.editions })),
    };
  }

  const self = {
    /** A bundle of courses of one series made ready to download (`editions`: those asked of each,
     *  else every one installed): its name and size. One not downloaded within an hour goes. */
    async prepare(series: string, courses: string[], editions?: string[]) {
      files.sweep();
      await recovered;
      const key = `${series}/${[...courses].sort().join(",")}`;
      const asked = editions ? [...editions].sort().join("+") : "";
      return staging(`${key} ${asked}`, async () => {
        // One export of a course at a time: the same asked again while it waits is that one.
        const had = byCourse.get(key);
        if (had?.asked === asked && prepared.waiting(SERVER, had.ready.id)) return had.ready;
        if (had) prepared.drop(had.ready.id);
        byCourse.delete(key);
        const staged = await guarded(() => files.stage(series, courses, editions));
        try {
          const ready = keep(staged);
          byCourse.set(key, { asked, ready });
          return ready;
        } catch (error) {
          files.discard(staged.id);
          throw error;
        }
      });
    },

    /** A prepared export still there to download: its file's name and size (404 when it is gone or
     *  downloaded). Nothing taken: asked before a download starts. */
    ready(id: string) {
      const { fileName, bytes } = prepared.ready(SERVER, id);
      return { fileName, bytes };
    },

    /** A prepared export as a stream, once (404 as `ready`). */
    download(id: string) {
      const p = prepared.take(SERVER, id);
      return {
        stream: files.stream(id, p.manifest, p.paths),
        fileName: p.fileName,
        bytes: p.bytes,
      };
    },

    /** Courses of one series exported to a file (the command line): where, given the file's own
     *  name. */
    async exportTo(
      series: string,
      courses: string[],
      editions: string[] | undefined,
      where: (fileName: string) => string,
    ) {
      const ready = await self.prepare(series, courses, editions);
      const { stream, bytes } = self.download(ready.id);
      try {
        const file = where(ready.fileName);
        await guarded(() => files.save(stream, file, bytes));
        return { ...ready, file };
      } catch (error) {
        // The transfer goes with its stream.
        await stream.cancel().catch(() => undefined);
        throw error;
      }
    },

    /** Every installed course exported, a file a group of a series (no media file in two), each
     *  with every edition (the command line): `done` told of each file as it is written. */
    async exportAll(
      where: (fileName: string) => string,
      done?: (file: {
        file: string;
        bytes: number;
        courses: Array<{ course: string; editions: string[] }>;
      }) => void,
    ) {
      const written = [];
      for (const { series, courses } of await files.groups()) {
        const file = await self.exportTo(series, courses, undefined, where);
        done?.(file);
        written.push(file);
      }
      return written;
    },

    /** A bundle uploaded and imported. */
    async importUpload(body: AsyncIterable<Uint8Array> | null, length: number | undefined) {
      // Before a byte of it is read: its length told, and not too large.
      if (length === undefined) throw new ServiceError("length_required", 411);
      if (length > COURSE_BUNDLE_MAX_BYTES) throw new ServiceError("course_bundle_too_large", 413);
      if (!body) throw new ServiceError("not_a_course_bundle", 422);
      return alone(async () => {
        files.sweep();
        await recovered;
        const id = files.begin();
        try {
          return await guarded(async () => {
            try {
              return await settle(id, { body, length });
            } catch (error) {
              // More than its length said.
              if ((error as { code?: string } | null)?.code === "EFBIG")
                throw new ServiceError("course_bundle_too_large", 413);
              throw error;
            }
          }, "course_bundle_damaged");
        } finally {
          files.discard(id);
        }
      });
    },

    /** A bundle on disk imported (the command line). */
    importFile: (file: string) =>
      alone(async () => {
        files.sweep();
        await recovered;
        const id = files.begin();
        try {
          return await guarded(() => settle(id, { file }), "course_bundle_damaged");
        } finally {
          files.discard(id);
        }
      }),
  };
  return self;
}
export type CourseTransfer = ReturnType<typeof createCourseTransfer>;

/** A bundle's file name: keys and dates only, any disk takes it. One course with its editions
 *  (`dw.nicos-weg-a1-ru-ru-de-2026-10-12`); several by what their ids begin with and how many
 *  (`dw.nicos-weg-a1-19-courses-2026-10-12`). */
export function bundleName(
  courses: ReadonlyArray<{ course: string; editions: string[] }>,
  day: string,
) {
  const [first] = courses;
  if (!first) throw new Error("a bundle of no course");
  const series = first.course.slice(0, first.course.indexOf("/"));
  if (courses.length === 1)
    return `${first.course.replace("/", "-")}-${first.editions.join("+")}-${day}${COURSE_BUNDLE_EXTENSION}`;
  const ids = courses.map((c) => c.course.slice(series.length + 1));
  let common = ids.reduce((a, b) => {
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    return a.slice(0, i);
  });
  common = common.slice(0, common.lastIndexOf("-") + 1).replace(/-$/, "");
  return `${series}-${common ? `${common}-` : ""}${courses.length}-courses-${day}${COURSE_BUNDLE_EXTENSION}`;
}
