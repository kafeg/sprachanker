// A downloaded course — or exam — moved between one's own machines as one file (02, "Course
// bundle"): exported — its files of the editions asked, the media they use, a manifest with a hash
// per file, streamed as a zip — and imported: every file checked against the manifest and by its
// schema before anything is moved into place, media the library holds not unpacked again, the
// course replaced where its content differs, all or nothing, then verified. The files themselves are
// the runtime's (CourseTransferFiles).
import {
  COURSE_BUNDLE_EXTENSION,
  COURSE_BUNDLE_FORMAT,
  COURSE_BUNDLE_MAX_BYTES,
  COURSE_BUNDLE_VERSION,
  CourseBundleManifest,
  type CourseKey,
  type CourseSource,
  type KeyMapFile,
  type MediaIndex,
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

/** What a course's export holds, made ready in a transfer (the manifest's parts the runtime knows). */
export interface StagedCourse {
  id: string;
  course: CourseKey;
  kind: "course" | "exam";
  editions: string[];
  provider: string | null;
  source: CourseSource | null;
  titles: Record<string, string>;
  content: { canonical: string; editions: Record<string, string> };
  media: MediaIndex;
  keys: KeyMapFile;
  files: BundleFileEntry[];
}

/** A course installed from a bundle: whether it was new, the same or replaced; its media placed and
 *  kept; what `verify` found. */
export interface InstalledBundle {
  status: "added" | "same" | "replaced";
  media: { added: number; kept: number };
  check: { problems: number; missing: number };
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
  /** A course's files (`editions`: those asked, else every one installed) linked into a new
   *  transfer, each hashed; NotInstalledError when the course or an edition is not here. */
  stage(series: string, course: string, editions?: string[]): Promise<StagedCourse>;
  /** The length of the bundle `stream` makes. */
  bytes(id: string, manifest: string, paths: string[]): number;
  /** A staged course as a bundle: `manifest.json` first, then its files in the order given; the
   *  transfer goes when the stream ends or is cancelled. */
  stream(id: string, manifest: string, paths: string[]): ReadableStream<Uint8Array>;
  /** A stream written whole to a file (beside it, then renamed), its disk checked for `bytes` first. */
  save(stream: ReadableStream<Uint8Array>, file: string, bytes: number): Promise<void>;
  /** A new, empty transfer. */
  begin(): string;
  /** A bundle of `length` bytes received into the transfer, the room for it checked first; false
   *  when more comes. */
  receive(id: string, body: AsyncIterable<Uint8Array>, length: number): Promise<boolean>;
  /** A bundle read by its zip directory — the one received, or `file` on disk: its manifest's text
   *  and the other files' paths and sizes; undefined when it is no zip of stored entries with a
   *  manifest and paths a bundle may hold, each once. */
  read(
    id: string,
    file?: string,
  ): { manifest: string; entries: Array<{ path: string; size: number }> } | undefined;
  /** What the library lacks of it unpacked into the transfer, streamed and hashed: "damaged" at the
   *  first file not as listed; "clash" when a media file the library has under its name holds other
   *  content (nothing unpacked). */
  unpack(
    id: string,
    manifest: CourseBundleManifest,
    file?: string,
  ): Promise<"ok" | "damaged" | "clash">;
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
  /** Called when a course was installed from a bundle: its files may have changed. */
  onInstalled?: () => void;
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

  /** The received or given file checked, unpacked and installed; the transfer is the caller's to
   *  discard. */
  async function settle(id: string, file?: string) {
    const read = files.read(id, file);
    if (!read) throw new ServiceError("not_a_course_bundle", 422);
    let json: unknown;
    try {
      json = JSON.parse(read.manifest);
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
    // Exactly the files listed, each with its size.
    const listed = new Map(manifest.files.map((f) => [f.path, f.size]));
    const sameFiles =
      listed.size === manifest.files.length &&
      listed.size === read.entries.length &&
      read.entries.every((e) => listed.get(e.path) === e.size);
    if (!sameFiles) throw new ServiceError("course_bundle_damaged", 422);
    const unpacked = await files.unpack(id, manifest, file);
    if (unpacked === "clash") throw new ServiceError("course_bundle_clash", 409);
    if (unpacked === "damaged") throw new ServiceError("course_bundle_damaged", 422);
    const problems = await files.check(id, manifest);
    if (problems.length) {
      console.error(`a course bundle of ${manifest.course} refused:\n  ${problems.join("\n  ")}`);
      throw new ServiceError("course_bundle_damaged", 422);
    }
    const installed = await files.install(id, manifest);
    deps.onInstalled?.();
    return {
      course: {
        key: manifest.course,
        kind: manifest.kind,
        editions: manifest.editions,
        titles: manifest.titles,
      },
      ...installed,
    };
  }

  /** The export made ready of each course (`<series>/<course>`), as asked (its editions, or "" for
   *  all): one a course, while it waits to be downloaded. */
  const byCourse = new Map<string, { asked: string; ready: ReturnType<typeof keep> }>();
  const staging = createOnce<ReturnType<typeof keep>>();

  /** A staged course made a prepared export: its manifest, file name and size. */
  function keep(staged: StagedCourse) {
    const paths = staged.files.map((f) => f.path);
    const manifest = JSON.stringify({
      format: COURSE_BUNDLE_FORMAT,
      version: COURSE_BUNDLE_VERSION,
      appVersion: deps.appVersion,
      exportedAt: now(),
      course: staged.course,
      kind: staged.kind,
      editions: staged.editions,
      provider: staged.provider,
      source: staged.source,
      titles: staged.titles,
      content: staged.content,
      media: staged.media,
      keys: staged.keys,
      files: staged.files,
    } satisfies CourseBundleManifest);
    const bytes = files.bytes(staged.id, manifest, paths);
    if (bytes > COURSE_BUNDLE_MAX_BYTES) throw new ServiceError("course_bundle_too_large", 422);
    const day = new Date(now()).toISOString().slice(0, 10);
    // `dw.nicos-weg-a1-ru-ru-de-2026-10-11.sprachanker-course`: keys and dates only, any disk takes it.
    const fileName = `${staged.course.replace("/", "-")}-${staged.editions.join("+")}-${day}${COURSE_BUNDLE_EXTENSION}`;
    prepared.keep(staged.id, SERVER, { manifest, paths, fileName, bytes });
    return { id: staged.id, fileName, bytes, course: staged.course, editions: staged.editions };
  }

  const self = {
    /** A course's bundle made ready to download (`editions`: those asked, else every one installed):
     *  its name and size. One not downloaded within an hour goes. */
    async prepare(series: string, course: string, editions?: string[]) {
      files.sweep();
      await recovered;
      const key = `${series}/${course}`;
      const asked = editions ? [...editions].sort().join("+") : "";
      return staging(`${key} ${asked}`, async () => {
        // One export of a course at a time: the same asked again while it waits is that one.
        const had = byCourse.get(key);
        if (had?.asked === asked && prepared.waiting(SERVER, had.ready.id)) return had.ready;
        if (had) prepared.drop(had.ready.id);
        byCourse.delete(key);
        const staged = await guarded(() => files.stage(series, course, editions));
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

    /** A course exported to a file (the command line): where, given the file's own name. */
    async exportTo(
      series: string,
      course: string,
      editions: string[] | undefined,
      where: (fileName: string) => string,
    ) {
      const ready = await self.prepare(series, course, editions);
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
            if (!(await files.receive(id, body, length)))
              throw new ServiceError("course_bundle_too_large", 413);
            return await settle(id);
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
          return await guarded(() => settle(id, file), "course_bundle_damaged");
        } finally {
          files.discard(id);
        }
      }),
  };
  return self;
}
export type CourseTransfer = ReturnType<typeof createCourseTransfer>;
