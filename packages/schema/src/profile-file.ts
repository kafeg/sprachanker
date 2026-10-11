// A profile file (05, "Profile file"): one learner's data moved between one's own machines — a zip of
// stored entries holding `manifest.json`, the profile's database without its secrets and its
// recordings. The manifest says what the file holds and what it was made from.
import { z } from "zod";
import { Sha256 } from "./common.ts";
import { PROFILE_NAME_MAX, ProfileColour } from "./settings.ts";

export const PROFILE_FILE_FORMAT = "sprachanker-profile";
/** Bumped when a file of this version could not be read by an app that reads the previous one. */
export const PROFILE_FILE_VERSION = 1;
export const PROFILE_FILE_EXTENSION = ".sprachanker-profile";
/** A profile file is at most this large (a profile is its database and recordings: far less). */
export const PROFILE_FILE_MAX_BYTES = 4_000_000_000;
/** The most files a profile file lists (its database and recordings), its manifest apart. */
export const PROFILE_FILE_MAX_FILES = 1_000_000;

/** A file in a profile file besides its manifest: the database, or a recording (`<ulid>.<ext>`). */
export const ProfileFilePath = z
  .string()
  .regex(/^(profile\.sqlite|recordings\/[0-9A-HJKMNP-TV-Z]{26}\.[a-z0-9]{1,8})$/);

const Used = z.object({
  key: z.string().min(1).max(200),
  /** As titled where the file was made (null: not installed there either). */
  title: z.string().max(400).nullable(),
  editions: z.array(z.string().max(40)).max(100),
});

/** The content a profile's runs and cards name: courses (lessons, chats, scenes, their words'
 *  cards), exams, imported decks. */
export const ContentUsed = z.object({
  courses: z.array(Used).max(10_000),
  exams: z.array(Used).max(10_000),
  decks: z
    .array(z.object({ id: z.string().min(1).max(80), title: z.string().max(400).nullable() }))
    .max(10_000),
});
export type ContentUsed = z.infer<typeof ContentUsed>;

export const ProfileManifest = z.object({
  format: z.literal(PROFILE_FILE_FORMAT),
  /** A newer version than the app reads is refused (`profile_from_newer_app`). */
  version: z.number().int().min(1),
  appVersion: z.string().max(40),
  exportedAt: z.number(),
  profile: z.object({
    name: z.string().trim().min(1).max(PROFILE_NAME_MAX),
    colour: ProfileColour.catch("amber"),
  }),
  /** The migrations its database has, in the order applied (05, "Migrations"). */
  migrations: z.array(z.string().min(1).max(200)).max(10_000),
  content: ContentUsed,
  /** What the file does not hold: the providers whose API keys were stored (06, "Secrets"), and those
   *  whose endpoint's address held a user name or password (taken out of it). */
  leftOut: z.object({
    apiKeys: z.array(z.string().max(40)).max(100),
    endpointLogins: z.array(z.string().max(40)).max(100).default([]),
  }),
  /** Every file but the manifest, each once. */
  files: z
    .array(
      z.object({ path: ProfileFilePath, size: z.number().int().nonnegative(), sha256: Sha256 }),
    )
    .max(PROFILE_FILE_MAX_FILES),
});
export type ProfileManifest = z.infer<typeof ProfileManifest>;
