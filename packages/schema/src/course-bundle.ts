// A course bundle: one downloaded course — or exam: a course of exams — moved to
// another of one's own machines as a zip of stored entries holding `manifest.json`, the course's library
// files of the editions it carries, the media they use and the copies its exams were read from. The
// manifest is the course's manifest: what it holds, a hash per file, its content
// versions, its lines of the series' media index and key map.
import { z } from "zod";
import { CourseSource } from "./canonical.ts";
import { Sha256 } from "./common.ts";
import { CourseKey } from "./keys.ts";
import { EditionId } from "./lang.ts";
import { KeyMapFile, MediaIndex, portableName, storableMedia } from "./library-state.ts";

export const COURSE_BUNDLE_FORMAT = "sprachanker-course";
/** Bumped when a bundle of this version could not be read by an app that reads the previous one. */
export const COURSE_BUNDLE_VERSION = 1;
export const COURSE_BUNDLE_EXTENSION = ".sprachanker-course";
/** A bundle is at most this large (a DW course is under 5 GB, videos and all). */
export const COURSE_BUNDLE_MAX_BYTES = 16 * 1024 ** 3;
/** The most files a bundle lists, its manifest apart. */
export const COURSE_BUNDLE_MAX_FILES = 500_000;

const SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";
const EDITION = "[a-z]{2,3}-[a-z]{2,3}";
const LESSON_FILE = "lessons/\\d{2,}-\\d{2,}\\.json";
const EXAM_FILE = `exams/${SLUG}\\.json`;
const PLACES = new RegExp(
  `^(?:canonical/${SLUG}/(?:course\\.json|${LESSON_FILE}|${EXAM_FILE}|sources/${SLUG}\\.json)` +
    `|locale/${EDITION}/${SLUG}/(?:course\\.json|${LESSON_FILE}|${EXAM_FILE})` +
    "|media/[^/]+/[^/]+" +
    `|raw/${EDITION}/${SLUG}(?:/[^/]+)+)$`,
);

/** A file a bundle may hold, as its path in the series folder: a course's canonical files, an
 *  edition's locale files, a media file the media store could keep (its kind's extensions only), a
 *  source copy kept in `raw/<edition>/<course>/`. Nothing else: every name
 *  portable (no `..`, nothing a disk refuses), no folder of another kind. */
export const CourseBundlePath = z
  .string()
  .max(512)
  .refine(
    (path) =>
      PLACES.test(path) &&
      path.split("/").every(portableName) &&
      (!path.startsWith("media/") || storableMedia(path.slice("media/".length))),
  );

/** The course a bundle path is of: its folder under `canonical/`, `locale/<edition>/`, `raw/<edition>/`
 *  (undefined for a media file: the series'). */
export const bundlePathCourse = (path: string) => {
  const parts = path.split("/");
  if (parts[0] === "canonical") return parts[1];
  return parts[0] === "locale" || parts[0] === "raw" ? parts[2] : undefined;
};

export const CourseBundleManifest = z.strictObject({
  format: z.literal(COURSE_BUNDLE_FORMAT),
  /** A newer version than the app reads is refused (`course_bundle_from_newer_app`). */
  version: z.number().int().min(1),
  appVersion: z.string().max(40),
  exportedAt: z.number(),
  course: CourseKey,
  /** A course of exams only is an exam (shown in Exams). */
  kind: z.enum(["course", "exam"]),
  editions: z.array(EditionId).min(1).max(100),
  /** The provider that writes its series (`dw-nicos-weg`); null for a series none writes. */
  provider: z.string().max(80).nullable(),
  /** Where the course comes from, as its index says. */
  source: CourseSource.nullable(),
  /** Its title in each edition. */
  titles: z.record(EditionId, z.string().max(400)),
  /** Content versions: a hash of its canonical files, and of each edition's locale files (each a
   *  sha256 over the files' paths and hashes, in path order). */
  content: z.strictObject({ canonical: Sha256, editions: z.record(EditionId, Sha256) }),
  /** The lines of the series' media index (`media.json`) for the media it holds. */
  media: MediaIndex,
  /** The scopes of the series' key map (`keys.json`) under the course. */
  keys: KeyMapFile,
  /** Every file but the manifest, each once. */
  files: z
    .array(
      z.strictObject({
        path: CourseBundlePath,
        size: z.number().int().nonnegative(),
        sha256: Sha256,
      }),
    )
    .max(COURSE_BUNDLE_MAX_FILES),
});
export type CourseBundleManifest = z.infer<typeof CourseBundleManifest>;
