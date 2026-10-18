// Whether a newer version of the app is out, and how this build is updated — as data: the UI words it
// in the learner's language.
import { z } from "zod";

/** What keeps this build up to date: the desktop app it runs in (it updates itself), the program the
 *  installer put there (its command again, or a new archive), the phone app (it downloads the new
 *  version and hands it to the system's installer), or a build from the sources (none). */
export const UpdatedBy = z.enum(["desktop", "program", "phone", "source"]);
export type UpdatedBy = z.infer<typeof UpdatedBy>;

/** The system the server runs on. */
export const AppSystem = z.enum(["macos", "windows", "linux", "android", "ios"]);
export type AppSystem = z.infer<typeof AppSystem>;

/** This build's version, how it is updated and on which system (absent for a build from the
 *  sources); `newer`: the latest release, when it is newer than this build (absent: none, or not
 *  known — the check did not answer); `installs`: the server downloads and installs it itself on
 *  request (the phone app). */
export const UpdateStatus = z.object({
  version: z.string(),
  by: UpdatedBy,
  system: AppSystem.optional(),
  newer: z.object({ version: z.string(), url: z.string() }).optional(),
  installs: z.boolean(),
});
export type UpdateStatus = z.infer<typeof UpdateStatus>;
