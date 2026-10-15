// A course's practice written: a variant added to its lesson's practice in an edition — its
// recordings first, then the lesson's file rewritten whole with the variant at its end. The caller
// holds the series' lock (a bundle installed merges into the same files).
import {
  EditionId,
  type Lang,
  type LessonKey,
  PracticeLesson,
  type PracticeSpeaking,
  type PracticeText,
  type PracticeWriting,
  SeriesKey,
} from "@sprachanker/schema";
import { prettyJson } from "./canonical-json.ts";
import { type DataFs, joinPath } from "./data-fs.ts";
import { writeFileAtomic } from "./files.ts";
import { libraryFile } from "./provider.ts";

/** A variant of one step, as added. */
export type PracticeVariant =
  | { step: "reading" | "listening"; variant: PracticeText }
  | { step: "writing"; variant: PracticeWriting }
  | { step: "speaking"; variant: PracticeSpeaking };

/** Adds a variant to a lesson's practice (made when it has none), its recordings written first. */
export async function addPractice(
  fs: DataFs,
  libraryRoot: string,
  series: string,
  practice: {
    lesson: LessonKey;
    edition: string;
    language: Lang;
    add: PracticeVariant;
    recordings?: Array<{ path: string; wav: Uint8Array }>;
  },
) {
  if (!SeriesKey.safeParse(series).success || !EditionId.safeParse(practice.edition).success)
    throw new Error(`no practice of ${series} ${practice.edition}`);
  const seriesDir = joinPath(libraryRoot, series);
  const empty: PracticeLesson = {
    format: 1,
    lesson: practice.lesson,
    edition: practice.edition,
    language: practice.language,
    reading: [],
    listening: [],
    writing: [],
    speaking: [],
  };
  const file = libraryFile.practice(empty);
  const target = joinPath(seriesDir, file.path);
  const text = fs.readText(target);
  const was = text !== undefined ? PracticeLesson.parse(JSON.parse(text)) : empty;
  for (const r of practice.recordings ?? []) {
    if (!r.path.startsWith(`${file.path.slice(0, -".json".length)}/`))
      throw new Error(`${r.path}: not the lesson's`);
    await writeFileAtomic(fs, joinPath(seriesDir, r.path), r.wav);
  }
  const { step, variant } = practice.add;
  const next = { ...was, [step]: [...was[step], variant] } as PracticeLesson;
  await writeFileAtomic(fs, target, prettyJson(PracticeLesson.parse(next)));
  return next;
}
