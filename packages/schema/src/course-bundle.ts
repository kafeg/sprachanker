// A course bundle: downloaded courses of one series — or exams: courses of exams — moved to another
// of one's own machines, or kept aside, as a zip of stored entries holding `manifest.json`, the
// courses' library files of the editions it carries, the media they use (each once: a series' courses
// in several languages share their videos) and the copies their exams were read from. The manifest
// says what it holds: its courses with their content versions, a hash per file, its lines of the
// series' media index and key map.
import { z } from "zod";
import { CourseSource } from "./canonical.ts";
import { Sha256 } from "./common.ts";
import { CourseKey } from "./keys.ts";
import { EditionId } from "./lang.ts";
import { KeyMapFile, MediaIndex, portableName, storableMedia } from "./library-state.ts";

export const COURSE_BUNDLE_FORMAT = "sprachanker-course";
/** Bumped when a bundle of this version could not be read by an app that reads the previous one
 *  (2: several courses a bundle; a bundle of 1, one course, is read no more). */
export const COURSE_BUNDLE_VERSION = 2;
export const COURSE_BUNDLE_EXTENSION = ".sprachanker-course";
/** A bundle is at most this large (a DW course is under 5 GB, videos and all; its other languages add
 *  their texts only; all of Nicos Weg is some 10 GB). */
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
    `|raw/${EDITION}/${SLUG}(?:/[^/]+)+` +
    `|practice/${EDITION}/${SLUG}/(?:\\d{2,}-\\d{2,}\\.json|\\d{2,}-\\d{2,}/${SLUG}\\.wav))$`,
);

/** A file a bundle may hold, as its path in the series folder: a course's canonical files, an
 *  edition's locale files, a media file the media store could keep (its kind's extensions only), a
 *  source copy kept in `raw/<edition>/<course>/`, an edition's practice made once and its recordings
 *  (`practice/<edition>/<course>/`). Nothing else: every name
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

/** The course a bundle path is of (its id): its folder under `canonical/`, `locale/<edition>/`,
 *  `raw/<edition>/`, `practice/<edition>/` (undefined for a media file: the series'). */
export const bundlePathCourse = (path: string) => {
  const parts = path.split("/");
  if (parts[0] === "canonical") return parts[1];
  return parts[0] === "locale" || parts[0] === "raw" || parts[0] === "practice"
    ? parts[2]
    : undefined;
};

/** A course a bundle holds. */
export const CourseBundleCourse = z.strictObject({
  course: CourseKey,
  /** A course of exams only is an exam (shown in Exams). */
  kind: z.enum(["course", "exam"]),
  editions: z.array(EditionId).min(1).max(100),
  /** Where the course comes from, as its index says. */
  source: CourseSource.nullable(),
  /** Its title in each edition. */
  titles: z.record(EditionId, z.string().max(400)),
  /** Content versions: a hash of its canonical files, and of each edition's locale files (each a
   *  sha256 over the files' paths and hashes, in path order). */
  content: z.strictObject({
    canonical: Sha256,
    editions: z.record(EditionId, Sha256),
    /** Each edition's practice made once that the bundle holds (none: none made). */
    practice: z.record(EditionId, Sha256).optional(),
  }),
});
export type CourseBundleCourse = z.infer<typeof CourseBundleCourse>;

export const CourseBundleManifest = z.strictObject({
  format: z.literal(COURSE_BUNDLE_FORMAT),
  /** A newer version than the app reads is refused (`course_bundle_from_newer_app`). */
  version: z.literal(COURSE_BUNDLE_VERSION),
  appVersion: z.string().max(40),
  exportedAt: z.number(),
  /** Its courses, of one series, each once. */
  courses: z
    .array(CourseBundleCourse)
    .min(1)
    .max(500)
    .refine(
      (cs) =>
        new Set(cs.map((c) => c.course)).size === cs.length &&
        new Set(cs.map((c) => c.course.slice(0, c.course.indexOf("/")))).size === 1,
    ),
  /** The provider that writes its series (`dw-nicos-weg`); null for a series none writes. */
  provider: z.string().max(80).nullable(),
  /** The lines of the series' media index (`media.json`) for the media it holds. */
  media: MediaIndex,
  /** The scopes of the series' key map (`keys.json`) under its courses. */
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
