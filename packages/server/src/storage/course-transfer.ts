// Course bundles on disk: each export or import in a transfer folder of its own,
// `library/.transfers/<id>/` (transfers.ts) — on the library's disk, so files link and move into
// place. One path on every system, the phone's too: an export streams its zip straight from the
// library's files — only those a later import rewrites in place (library JSON, source copies: small)
// linked or copied aside first, so a course normalised again meanwhile keeps the bundle whole —, each
// hashed when made ready and found unchanged when streamed; an import reads the bundle as it comes (the
// upload, or a file), what the library lacks written into the transfer as it passes, hashed, the zip's
// directory checked at its end, then checked and installed by course-kit's bundle.
import {
  aliased,
  type BundlePlan,
  bundleGroups,
  bundleSeries,
  bytesEntry,
  checkBundle,
  contentVersions,
  courseBundleContent,
  crc32,
  dirName,
  errorCode,
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
  writtenOnce,
  type ZipEntryRead,
  zipLength,
  zipLimits,
  zipRead,
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

/** A file of an export made ready: where it is read from, as it was summed then. */
interface ReadyFile {
  file: string;
  size: number;
  crc32: number;
  mtimeMs: number;
}

/** The text of chunks and their CRC-32 (a manifest: its size checked before). */
async function textOf(chunks: AsyncIterable<Uint8Array>) {
  const decoder = new TextDecoder();
  let text = "";
  let crc = 0;
  for await (const chunk of chunks) {
    text += decoder.decode(chunk, { stream: true });
    crc = crc32(chunk, crc);
  }
  return { text: text + decoder.decode(), crc };
}

export function courseTransferFiles(
  data: DataRoot,
  options: TransferOptions = {},
): CourseTransferFiles {
  const { fs } = data;
  const libraryRoot = under(data, "library");
  const root = joinPath(libraryRoot, ".transfers");
  /** Each import's bundle as it is read, after its manifest. */
  const reading = new Map<string, AsyncGenerator<ZipEntryRead>>();
  /** Each import's plan: what of it the library holds already. */
  const plans = new Map<string, BundlePlan>();
  /** Each export's files made ready, until it is streamed. */
  const ready = new Map<string, Map<string, ReadyFile>>();
  // A transfer swept with an install it stopped midway: undone first.
  const t = transferFolders(fs, root, options, (folder) =>
    undoInstall(fs, libraryRoot, joinPath(folder, "aside")),
  );
  const filesOf = (id: string) => joinPath(t.folder(id), "files");
  const asideOf = (id: string) => joinPath(t.folder(id), "aside");
  const discard = (id: string) => {
    ready.delete(id);
    plans.delete(id);
    // A bundle read no further: its source let go (an upload, a file).
    reading
      .get(id)
      ?.return(undefined)
      .catch(() => {});
    reading.delete(id);
    t.discard(id);
  };
  /** The zip's entries: the manifest first, then the files made ready in the order given. */
  const zipOf = (id: string, manifest: string, paths: string[]) => {
    const of = ready.get(id);
    return [
      bytesEntry(MANIFEST, new TextEncoder().encode(manifest)),
      ...paths.map((path) => {
        const f = of?.get(path);
        if (!f) throw new Error(`${path} is not in transfer ${id}`);
        return fileEntry(fs, path, f.file, f);
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
        // What it holds, as it is while no import changes it (an import replaces a course's files
        // one by one): under the series' lock — not waited for: a download holds it for long. What
        // an import rewrites in place is linked aside (copied where the disk has no hard links:
        // small, its room checked first); media and recordings stay where they are.
        const content = await withSeriesLock(
          data,
          series,
          async () => {
            const content = await courseBundleContent(fs, libraryRoot, series, courses, editions);
            for (const f of content.files) {
              if (writtenOnce(f.path)) continue;
              const to = joinPath(filesOf(id), f.path);
              fs.mkdir(dirName(to));
              linkOrCopy(fs, f.file, to, () => t.room(root, fs.stat(f.file)?.size ?? 0));
            }
            return content;
          },
          { wait: false },
        );
        // Each hashed after, the lock let go, with its time of change: one not so when it is
        // streamed fails the stream.
        const files: BundleFileEntry[] = [];
        const summed = new Map<string, ReadyFile>();
        for (const f of content.files) {
          const file = writtenOnce(f.path) ? f.file : joinPath(filesOf(id), f.path);
          // Gone or changed meanwhile (a course removed, a download): the series is busy.
          const busy = () =>
            Object.assign(new Error(`${f.path} changed while it was summed`), {
              code: "SERIES_BUSY",
            });
          const before = fs.stat(file);
          if (!before) throw busy();
          const { sha256, size, crc32 } = await fileSums(fs, file).catch((error) => {
            throw errorCode(error) === "ENOENT" ? busy() : error;
          });
          const after = fs.stat(file);
          if (after?.size !== size || after.mtimeMs !== before.mtimeMs) throw busy();
          files.push({ path: f.path, size, sha256 });
          summed.set(f.path, { file, size, crc32, mtimeMs: before.mtimeMs });
        }
        ready.set(id, summed);
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
      ready.delete(id);
      return t.zip(id, entries);
    },
    save: t.save,
    begin: t.begin,
    async read(id, from) {
      const source =
        "file" in from
          ? t.touching(id, fs.stream(from.file))
          : t.incoming(id, from.body, from.length);
      const zip = zipRead(source, ZIP_LIMITS);
      reading.set(id, zip);
      try {
        const first = await zip.next();
        if (first.done || first.value.name !== MANIFEST || first.value.size > MANIFEST_MAX)
          return undefined;
        // The manifest's own check (its lines of media.json and keys.json are installed as they
        // are; the files it lists are checked by their hashes).
        const { text, crc } = await textOf(first.value.data);
        return crc === first.value.crc32 ? text : undefined;
      } catch (error) {
        if (errorCode(error) === "EBADZIP") return undefined;
        throw error;
      }
    },
    async unpack(id, manifest) {
      const zip = reading.get(id);
      if (!zip) throw new Error(`transfer ${id} has no bundle being read`);
      const listed = new Map(manifest.files.map((f) => [f.path, f]));
      // Two names one file on a disk that does not tell case or Unicode forms apart.
      if (aliased([MANIFEST, ...listed.keys()])) return "not_a_bundle";
      // A library file is read whole when it is checked.
      if (manifest.files.some((f) => f.path.endsWith(".json") && f.size > JSON_MAX))
        return "damaged";
      const plan = await planBundle(fs, libraryRoot, manifest);
      if (plan.clash.length) return "clash";
      // The room for what of it is unpacked (media here already are not).
      t.room(
        root,
        manifest.files.filter((f) => plan.unpack.has(f.path)).reduce((n, f) => n + f.size, 0),
      );
      const seen = new Set<string>();
      try {
        for await (const e of zip) {
          if (!CourseBundlePath.safeParse(e.name).success) return "not_a_bundle";
          const want = listed.get(e.name);
          // A name not listed that is one listed on such a disk is no bundle's.
          if (!want && aliased([...listed.keys(), MANIFEST, e.name])) return "not_a_bundle";
          if (!want || seen.has(e.name) || want.size !== e.size) return "damaged";
          seen.add(e.name);
          // What the library holds passes by.
          if (!plan.unpack.has(e.name)) continue;
          const written = await writeChunks(fs, joinPath(filesOf(id), e.name), e.data, e.size);
          // The first file not as listed ends it.
          if (!written || written.size !== want.size || written.sha256 !== want.sha256)
            return "damaged";
        }
      } catch (error) {
        if (errorCode(error) === "EBADZIP") return "not_a_bundle";
        throw error;
      } finally {
        reading.delete(id);
      }
      if (seen.size !== listed.size) return "damaged";
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
