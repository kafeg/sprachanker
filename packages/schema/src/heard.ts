// What a course's recordings of the source's answers say (owner, 2026-10-18): each heard once by
// Whisper on this machine, so an answer said aloud is checked against the source's own answer by the
// engine, without a model. Made into the course as its practice is — kept beside it in the library,
// carried in its bundles and merged on import, kept when the course is removed: `heard/<course>.json`.
// By the recording's media path (a media name keeps its content), so a recording several items use
// is heard once.
import { z } from "zod";
import { format, MediaPath } from "./common.ts";
import { CourseKey, courseIdOf } from "./keys.ts";
import { Lang } from "./lang.ts";

export const HEARD_FORMAT = 1;

/** A recording as heard: the text as Whisper wrote it (never edited), by which model, when. */
export const HeardRecording = z.strictObject({
  text: z.string().max(4000),
  model: z.string().min(1).max(200),
  heardAt: z.number(),
});
export type HeardRecording = z.infer<typeof HeardRecording>;

export const CourseHeard = z.strictObject({
  format: format(HEARD_FORMAT),
  course: CourseKey,
  /** The language the recordings were heard in: the course's target language. */
  lang: Lang,
  recordings: z.record(MediaPath, HeardRecording),
});
export type CourseHeard = z.infer<typeof CourseHeard>;

/** Where a course's recordings heard are kept: its path in the series folder. */
export const heardPath = (course: CourseKey | string) => `heard/${courseIdOf(course)}.json`;

/** The texts of the recordings heard, by media path (what the engine checks spoken answers with). */
export const heardTexts = (heard: CourseHeard | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(heard?.recordings ?? {}).map(([path, r]) => [path, r.text]));

/** Two of a course's recordings heard as one: `ours` kept, what only `theirs` has added. */
export const mergeHeard = (ours: CourseHeard, theirs: CourseHeard): CourseHeard => ({
  ...ours,
  recordings: { ...theirs.recordings, ...ours.recordings },
});
