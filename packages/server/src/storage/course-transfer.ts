// Course bundles on disk: each export or import in a transfer folder of its own,
// `library/.transfers/<id>/` (transfers.ts) — on the library's disk, so files link and move into
// place. An export's files linked there (a course normalised again meanwhile keeps the bundle whole),
// each hashed, streamed as a zip (course-kit); a received bundle read by its zip directory, what the
// library lacks unpacked streaming and hashed, checked and installed by course-kit's bundle.
import {
  aliased,
  type BundlePlan,
  bundleGroups,
  bundleSeries,
  bytesEntry,
  checkBundle,
  contentVersions,
  courseBundleContent,
  dirName,
  entryStream,
  entryText,
  fileEntry,
  fileSums,
  installBundle,
  installing,
  joinPath,
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
import type { BundleFileEntry, CourseTransferFiles } from "../services/course-transfer.ts";
import { downloadMarker, providerOf, withSeriesLock } from "./installer.ts";
import { type DataRoot, under } from "./root.ts";
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
  data: DataRoot,
  options: TransferOptions = {},
): CourseTransferFiles {
  const { fs } = data;
  const libraryRoot = under(data, "library");
  const root = joinPath(libraryRoot, ".transfers");
  // A transfer swept with an install it stopped midway: undone first.
  const t = transferFolders(fs, root, options, (folder) =>
    undoInstall(fs, libraryRoot, joinPath(folder, "aside")),
  );
  const filesOf = (id: string) => joinPath(t.folder(id), "files");
  const asideOf = (id: string) => joinPath(t.folder(id), "aside");
  const received = (id: string) => joinPath(t.folder(id), "received");
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
    const entries = zipEntries(fs, file, ZIP_LIMITS);
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
        return fileEntry(fs, path, joinPath(filesOf(id), path), sum);
      }),
    ];
  };

  const self: CourseTransferFiles = {
    sweep: t.sweep,
    async recover() {
      for (const id of fs.list(root)) {
        const aside = joinPath(root, id, "aside");
        try {
          const series = installing(fs, aside);
          // Under the series' lock: one another process holds is its install, running now.
          if (series)
            await withSeriesLock(data, series, async () => undoInstall(fs, libraryRoot, aside));
        } catch (error) {
          console.error(`an install stopped midway not undone (${id}): ${error}`);
        }
      }
    },
    async stage(series, courses, editions) {
      if (!SeriesKey.safeParse(series).success || !fs.stat(joinPath(libraryRoot, series)))
        throw new NotInstalledError(`${series}/${courses.join(",")}`);
      const id = t.begin();
      try {
        // Its files as they are while no import changes them (an import replaces a course's files
        // one by one): linked under the series' lock — not waited for: a download holds it for
        // long —, so a file replaced later stays as it was here. Copied where the disk has no hard
        // links, the room for it checked first. Hashed after, the lock let go.
        const content = await withSeriesLock(
          data,
          series,
          async () => {
            const content = await courseBundleContent(fs, libraryRoot, series, courses, editions);
            for (const f of content.files) {
              const to = joinPath(filesOf(id), f.path);
              fs.mkdir(dirName(to));
              linkOrCopy(fs, f.file, to, () => t.room(root, fs.stat(f.file)?.size ?? 0));
            }
            return content;
          },
          { wait: false },
        );
        const files: BundleFileEntry[] = [];
        const summed = new Map<string, { size: number; crc32: number }>();
        for (const f of content.files) {
          const { sha256, size, crc32 } = await fileSums(fs, joinPath(filesOf(id), f.path));
          files.push({ path: f.path, size, sha256 });
          summed.set(f.path, { size, crc32 });
        }
        sums.set(id, summed);
        return {
          id,
          courses: content.courses.map((c) => ({
            ...c,
            content: contentVersions(courseIdOf(c.course), c.editions, files),
          })),
          provider: providerOf(series),
          media: content.media,
          keys: content.keys,
          files,
        };
      } catch (error) {
        discard(id);
        throw error;
      }
    },
    async groups() {
      const series = [
        ...new Set(
          openLibrary(fs, libraryRoot)
            .courses()
            .map((c) => c.series),
        ),
      ];
      const out = [];
      for (const s of series)
        for (const courses of await bundleGroups(fs, libraryRoot, s))
          out.push({ series: s, courses });
      return out;
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
        manifest: entryText(fs, file, entries.manifest),
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
      const plan = await planBundle(fs, libraryRoot, manifest);
      if (plan.clash.length) return "clash";
      const wanted = entries.others.filter((e) => plan.unpack.has(e.name));
      t.room(
        root,
        wanted.reduce((n, e) => n + e.size, 0),
      );
      for (const e of wanted) {
        const written = await writeChunks(
          fs,
          joinPath(filesOf(id), e.name),
          t.touching(id, entryStream(fs, file, e)),
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
    check: (id, manifest) => checkBundle(fs, filesOf(id), manifest),
    async install(id, manifest) {
      const plan = plans.get(id);
      if (!plan) throw new Error(`transfer ${id} has nothing unpacked`);
      const series = bundleSeries(manifest);
      const done = await withSeriesLock(data, series, () =>
        installBundle({ fs, libraryRoot, files: filesOf(id), aside: asideOf(id), manifest, plan }),
      );
      const courses = [];
      for (const c of done.courses) {
        const course = courseIdOf(c.course);
        const report = await openLibrary(fs, libraryRoot).check(series, course);
        // A download it completes is no longer one to continue.
        if (!report.media.missing) fs.remove(downloadMarker(libraryRoot, series, course));
        courses.push({
          ...c,
          check: { problems: report.problems.length, missing: report.media.missing },
        });
      }
      return { courses, media: done.media };
    },
    discard,
  };
  return self;
}
