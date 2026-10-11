// Course bundles on disk (02, "Course bundle"): each export or import in a transfer folder of its own,
// `library/.transfers/<id>/` (transfers.ts) — on the library's disk, so files link and move into
// place. An export's files linked there (a course normalised again meanwhile keeps the bundle whole),
// each hashed, streamed as a zip (course-kit); a received bundle read by its zip directory, what the
// library lacks unpacked streaming and hashed, checked and installed by course-kit's bundle.
import { copyFileSync, linkSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import {
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
  openLibrary,
  planBundle,
  restoreAside,
  writeChunks,
  zipEntries,
  zipLength,
} from "@sprachanker/course-kit";
import { CourseBundlePath, courseIdOf } from "@sprachanker/schema";
import { downloadMarker, providerOf, withSeriesLock } from "../providers.ts";
import type { BundleFileEntry, CourseTransferFiles } from "../services/course-transfer.ts";
import { type TransferOptions, transferFolders } from "./transfers.ts";

const MANIFEST = "manifest.json";
/** A manifest is a line per file (and per media index line): a course's is a few MB. */
const MANIFEST_MAX = 64 * 1024 * 1024;
/** A library file is read whole to be checked: none is near this. */
const JSON_MAX = 64 * 1024 * 1024;
/** A bundle's zip: names as long as a media file's path may be, a directory of many files. */
const ZIP_LIMITS = { fieldMax: 1024, directoryMax: 256 * 1024 * 1024 };

export function courseTransferFiles(
  dataRoot: string,
  options: TransferOptions = {},
): CourseTransferFiles {
  const libraryRoot = join(dataRoot, "library");
  const root = join(libraryRoot, ".transfers");
  // A transfer swept with a course folder an install put aside (it stopped midway): put back first.
  const t = transferFolders(root, options, (folder) =>
    restoreAside(libraryRoot, join(folder, "aside")),
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
  /** The entries of a bundle, its manifest apart; each name a path a bundle may hold, and once. */
  const entriesOf = (file: string) => {
    const entries = zipEntries(file, ZIP_LIMITS);
    if (!entries) return undefined;
    const names = new Set(entries.map((e) => e.name));
    const manifest = entries.find((e) => e.name === MANIFEST);
    const others = entries.filter((e) => e !== manifest);
    if (
      names.size !== entries.length ||
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
    async stage(series, course, editions) {
      const content = await courseBundleContent(libraryRoot, series, course, editions);
      const id = t.begin();
      try {
        const files: BundleFileEntry[] = [];
        const summed = new Map<string, { size: number; crc32: number }>();
        for (const f of content.files) {
          const to = join(filesOf(id), f.path);
          mkdirSync(dirname(to), { recursive: true });
          // Linked: a file replaced in the library meanwhile stays as it was here. Copied where the
          // disk has no hard links, the room for it checked first.
          try {
            linkSync(f.file, to);
          } catch {
            t.room(root, statSync(f.file).size);
            copyFileSync(f.file, to);
          }
          const { sha256, size, crc32 } = await fileSums(to);
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
      const entries = entriesOf(file);
      if (!entries) return undefined;
      return {
        manifest: entryBytes(file, entries.manifest).toString("utf8"),
        entries: entries.others.map((e) => ({ path: e.name, size: e.size })),
      };
    },
    async unpack(id, manifest, file = received(id)) {
      const entries = entriesOf(file);
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
