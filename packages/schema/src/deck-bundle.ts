// A deck file: one deck moved to another of one's own machines with what was made for its words — a
// zip of stored entries holding `manifest.json` and the deck's folder: deck.json (an imported deck,
// a profile's Finds), extras.json (the audio read aloud, the AI's examples) and media/. A course's
// deck is its words' extras only: the words themselves come with the course.
import { z } from "zod";
import { Sha256 } from "./common.ts";
import {
  courseDeckFolder,
  DECK_AUDIO_EXTENSIONS,
  DeckFolder,
  DeckId,
  DeckMediaPath,
  isFindsDeck,
} from "./deck.ts";
import { CourseKey } from "./keys.ts";
import { Lang } from "./lang.ts";
import { portableName } from "./library-state.ts";

export const DECK_BUNDLE_FORMAT = "sprachanker-deck";
/** Bumped when a file of this version could not be read by an app that reads the previous one. */
export const DECK_BUNDLE_VERSION = 1;
export const DECK_BUNDLE_EXTENSION = ".sprachanker-deck";
/** A deck file is at most this large (a deck's audio: a few hundred MB at most). */
export const DECK_BUNDLE_MAX_BYTES = 4 * 1024 ** 3;
/** The most files a deck file lists, its manifest apart. */
export const DECK_BUNDLE_MAX_FILES = 200_000;

/** A file a deck file may hold besides its manifest, as its path in the deck's folder: deck.json,
 *  extras.json, or an audio file of its media (a portable name, a deck's audio extension). */
export const DeckBundlePath = z
  .string()
  .max(512)
  .refine((path) => {
    if (path === "deck.json" || path === "extras.json") return true;
    if (!DeckMediaPath.safeParse(path).success) return false;
    const name = path.slice("media/".length);
    const dot = name.lastIndexOf(".");
    return portableName(name) && dot > 0 && DECK_AUDIO_EXTENSIONS.includes(name.slice(dot + 1));
  });

/** What a deck file holds: a course's words' extras, an imported deck, a profile's Finds. */
export const DeckBundleKind = z.enum(["course", "imported", "finds"]);
export type DeckBundleKind = z.infer<typeof DeckBundleKind>;

/** The deck a file holds, as its manifest says. */
export const DeckBundleDeck = z
  .strictObject({
    kind: DeckBundleKind,
    /** Its folder where it was exported: an imported deck's id, a Finds deck's, a course's. */
    folder: DeckFolder,
    /** A course's deck: the course whose words it is of. */
    course: CourseKey.optional(),
    title: z.string().min(1).max(400),
    /** The language its words are in, and those their translations (and examples) are in. */
    lang: Lang,
    translationLangs: z.array(Lang).max(100),
    /** Its words (a course's: those something was made for), with audio, with examples. */
    words: z.number().int().nonnegative(),
    withAudio: z.number().int().nonnegative(),
    withExamples: z.number().int().nonnegative(),
  })
  .refine((d) => {
    if (d.kind === "course") return !!d.course && d.folder === courseDeckFolder(d.course);
    // A Finds deck's folder is a Finds id, an imported deck's never.
    return (
      !d.course &&
      DeckId.safeParse(d.folder).success &&
      isFindsDeck(d.folder) === (d.kind === "finds")
    );
  });
export type DeckBundleDeck = z.infer<typeof DeckBundleDeck>;

export const DeckBundleManifest = z.strictObject({
  format: z.literal(DECK_BUNDLE_FORMAT),
  /** A newer version than the app reads is refused (`deck_file_from_newer_app`). */
  version: z.literal(DECK_BUNDLE_VERSION),
  appVersion: z.string().max(40),
  exportedAt: z.number(),
  deck: DeckBundleDeck,
  /** Every file but the manifest, each once. */
  files: z
    .array(
      z.strictObject({
        path: DeckBundlePath,
        size: z.number().int().nonnegative(),
        sha256: Sha256,
      }),
    )
    .max(DECK_BUNDLE_MAX_FILES),
});
export type DeckBundleManifest = z.infer<typeof DeckBundleManifest>;
