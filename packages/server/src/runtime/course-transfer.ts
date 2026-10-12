// Course bundles on disk: each export or import in a transfer folder of its own,
// `library/.transfers/<id>/` (transfers.ts) — on the library's disk, so files link and move into
// place. An export's files linked there (a course normalised again meanwhile keeps the bundle whole),
// each hashed, streamed as a zip (course-kit); a received bundle read by its zip directory, what the
// library lacks unpacked streaming and hashed, checked and installed by course-kit's bundle.
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  aliased,
  type BundlePlan,
  bytesEntry,
  checkBundle,
  contentVersions,
  courseBundleContent,
  entryBytes,
  entryStream,
  fileEntry,
  fileSums,
  installBundle,
  installing,
  linkOrCopy,
  NotInstalledError,
  openLibrary,
  planBundle,
  undoInstall,
  writeChunks,
  zipEntries,
  zipLength,
  zipLimits,
} from "@sprachanker/course-kit";
import {
  COURSE_BUNDLE_MAX_FILES,
  CourseBundlePath,
  courseIdOf,
  SeriesKey,
} from "@sprachanker/schema";
import { downloadMarker, providerOf, withSeriesLock } from "../providers.ts";
import type { BundleFileEntry, CourseTransferFiles } from "../services/course-transfer.ts";
import { type TransferOptions, transferFolders } from "./transfers.ts";

const MANIFEST = "manifest.json";
/** A manifest is a line per file (and per media index line): a course's is a few MB. */
const MANIFEST_MAX = 64 * 1024 * 1024;
/** A library file is read whole to be checked: none is near this. */
const JSON_MAX = 64 * 1024 * 1024;
/** A bundle's zip: its files and manifest, names as long as a path may be (512 characters of UTF-8),
 *  some 250 bytes on average at most (a library path is under 100). */
const ZIP_LIMITS = zipLimits(COURSE_BUNDLE_MAX_FILES + 1, 1536, 256);

export function courseTransferFiles(
  dataRoot: string,
  options: TransferOptions = {},
): CourseTransferFiles {
  const libraryRoot = join(dataRoot, "library");
  const root = join(libraryRoot, ".transfers");
  // A transfer swept with an install it stopped midway: undone first.
  const t = transferFolders(root, options, (folder) =>
    undoInstall(libraryRoot, join(folder, "aside")),
  );
  const filesOf = (id: string) => join(t.folder(id), "files");
  const asideOf = (id: string) => join(t.folder(id), "aside");
  const received = (id: string) => join(t.folder(id), "received");
  /** Each staged course's files with their size and CRC-32 (the zip's), until it is streamed. */
  const sums = new Map<string, Map<string, { size: number; crc32: number }>>();
  /** Each import's plan: what of it the library holds already. */
  const plans = new Map<string, BundlePlan>();
  const discard = (id: string) => {
    sums.delete(id);
    plans.delete(id);
    t.discard(id);
  };
  /** The entries of a bundle, its manifest apart; each name a path a bundle may hold, and once —
   *  also to a disk that does not tell case or Unicode forms apart. */
  const entriesOf = (id: string, file: string) => t.once(id, file, () => parseEntries(file));
  const parseEntries = (file: string) => {
    const entries = zipEntries(file, ZIP_LIMITS);
    if (!entries) return undefined;
    const manifest = entries.find((e) => e.name === MANIFEST);
    const others = entries.filter((e) => e !== manifest);
    if (
      aliased(entries.map((e) => e.name)) ||
      !manifest ||
      manifest.size > MANIFEST_MAX ||
      others.some((e) => !CourseBundlePath.safeParse(e.name).success)
    )
      return undefined;
    return { manifest, others };
  };
  /** The zip's entries: the manifest first, then the staged files in the order given. */
  const zipOf = (id: string, manifest: string, paths: string[]) => {
    const of = sums.get(id);
    return [
      bytesEntry(MANIFEST, new TextEncoder().encode(manifest)),
      ...paths.map((path) => {
        const sum = of?.get(path);
        if (!sum) throw new Error(`${path} is not in transfer ${id}`);
        return fileEntry(path, join(filesOf(id), path), sum);
      }),
    ];
  };

  const self: CourseTransferFiles = {
    sweep: t.sweep,
    async recover() {
      for (const id of existsSync(root) ? readdirSync(root) : []) {
        const aside = join(root, id, "aside");
        try {
          const series = installing(aside);
          // Under the series' lock: one another process holds is its install, running now.
          if (series)
            await withSeriesLock(libraryRoot, series, async () => undoInstall(libraryRoot, aside));
        } catch (error) {
          console.error(`an install stopped midway not undone (${id}): ${error}`);
        }
      }
    },
    async stage(series, course, editions) {
      if (!SeriesKey.safeParse(series).success || !existsSync(join(libraryRoot, series)))
        throw new NotInstalledError(`${series}/${course}`);
      const id = t.begin();
      try {
        // Its files as they are while no import changes them (an import replaces a course's files
        // one by one): linked under the series' lock — not waited for: a download holds it for
        // long —, so a file replaced later stays as it was here. Copied where the disk has no hard
        // links, the room for it checked first. Hashed after, the lock let go.
        const content = await withSeriesLock(
          libraryRoot,
          series,
          async () => {
            const content = await courseBundleContent(libraryRoot, series, course, editions);
            for (const f of content.files) {
              const to = join(filesOf(id), f.path);
              mkdirSync(dirname(to), { recursive: true });
              linkOrCopy(f.file, to, () => t.room(root, statSync(f.file).size));
            }
            return content;
          },
          { wait: false },
        );
        const files: BundleFileEntry[] = [];
        const summed = new Map<string, { size: number; crc32: number }>();
        for (const f of content.files) {
          const { sha256, size, crc32 } = await fileSums(join(filesOf(id), f.path));
          files.push({ path: f.path, size, sha256 });
          summed.set(f.path, { size, crc32 });
        }
        sums.set(id, summed);
        return {
          id,
          course: content.course,
          kind: content.kind,
          editions: content.editions,
          provider: providerOf(series),
          source: content.source,
          titles: content.titles,
          content: contentVersions(course, content.editions, files),
          media: content.media,
          keys: content.keys,
          files,
        };
      } catch (error) {
        discard(id);
        throw error;
      }
    },
    bytes: (id, manifest, paths) => zipLength(zipOf(id, manifest, paths)),
    stream(id, manifest, paths) {
      const entries = zipOf(id, manifest, paths);
      sums.delete(id);
      return t.zip(id, entries);
    },
    save: t.save,
    begin: t.begin,
    // The file; the room for what of it is unpacked is checked then (media here already are not).
    receive: (id, body, length) => t.receive(id, "received", body, length, length),
    read(id, file = received(id)) {
      const entries = entriesOf(id, file);
      if (!entries) return undefined;
      return {
        manifest: entryBytes(file, entries.manifest).toString("utf8"),
        entries: entries.others.map((e) => ({ path: e.name, size: e.size })),
      };
    },
    async unpack(id, manifest, file = received(id)) {
      const entries = entriesOf(id, file);
      if (!entries) return "damaged";
      const listed = new Map(manifest.files.map((f) => [f.path, f]));
      // A library file is read whole when it is checked.
      if (manifest.files.some((f) => f.path.endsWith(".json") && f.size > JSON_MAX))
        return "damaged";
      const plan = await planBundle(libraryRoot, manifest);
      if (plan.clash.length) return "clash";
      const wanted = entries.others.filter((e) => plan.unpack.has(e.name));
      t.room(
        root,
        wanted.reduce((n, e) => n + e.size, 0),
      );
      for (const e of wanted) {
        const written = await writeChunks(
          join(filesOf(id), e.name),
          t.touching(id, entryStream(file, e)),
          e.size,
        );
        // The first file not as listed ends it.
        const want = listed.get(e.name);
        if (!written || written.size !== want?.size || written.sha256 !== want.sha256)
          return "damaged";
      }
      plans.set(id, plan);
      return "ok";
    },
    check: (id, manifest) => checkBundle(filesOf(id), manifest),
    async install(id, manifest) {
      const plan = plans.get(id);
      if (!plan) throw new Error(`transfer ${id} has nothing unpacked`);
      const series = manifest.course.slice(0, manifest.course.indexOf("/"));
      const course = courseIdOf(manifest.course);
      const done = await withSeriesLock(libraryRoot, series, () =>
        installBundle({ libraryRoot, files: filesOf(id), aside: asideOf(id), manifest, plan }),
      );
      const report = await openLibrary(libraryRoot).check(series, course);
      // A download it completes is no longer one to continue.
      if (!report.media.missing)
        rmSync(downloadMarker(libraryRoot, series, course), { force: true });
      return {
        ...done,
        check: { problems: report.problems.length, missing: report.media.missing },
      };
    },
    discard,
  };
  return self;
}
