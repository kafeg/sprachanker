// A course's recordings heard written (schema `heard.ts`): recordings added to its file, or heard
// again in place of what was there, the file rewritten whole. The caller holds the series' lock (a
// bundle installed merges into the same file).
import {
  type CourseHeard,
  CourseHeard as CourseHeardSchema,
  type CourseKey,
  type HeardRecording,
  type Lang,
  SeriesKey,
} from "@sprachanker/schema";
import { prettyJson } from "./canonical-json.ts";
import { type DataFs, joinPath } from "./data-fs.ts";
import { writeFileAtomic } from "./files.ts";
import { libraryFile } from "./provider.ts";

/** A file of recordings heard that does not read (broken, of a newer format, edited by hand): what
 *  it held, kept beside it as `<course>.json.unread` (the latest such) — the file is heard anew. */
function readOrSetAside(fs: DataFs, target: string, text: string | undefined) {
  if (text === undefined) return undefined;
  try {
    return CourseHeardSchema.parse(JSON.parse(text));
  } catch {
    fs.writeFile(`${target}.unread`, text);
    return undefined;
  }
}

/** Adds recordings heard to a course's file (made when it has none, or it does not read:
 *  readOrSetAside): a recording there already is replaced (heard again). Returns the file as
 *  written. */
export async function addHeard(
  fs: DataFs,
  libraryRoot: string,
  series: string,
  heard: { course: CourseKey; lang: Lang; recordings: Record<string, HeardRecording> },
): Promise<CourseHeard> {
  if (!SeriesKey.safeParse(series).success) throw new Error(`no series ${series}`);
  const empty: CourseHeard = { format: 1, course: heard.course, lang: heard.lang, recordings: {} };
  const file = libraryFile.heard(empty);
  const target = joinPath(libraryRoot, series, file.path);
  const text = fs.readText(target);
  const was = readOrSetAside(fs, target, text) ?? empty;
  const next = CourseHeardSchema.parse({
    ...was,
    lang: heard.lang,
    recordings: { ...was.recordings, ...heard.recordings },
  });
  await writeFileAtomic(fs, target, prettyJson(next));
  return next;
}
