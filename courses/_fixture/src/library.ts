// Writes the fixture course into a library folder, as an import would (tests, e2e): each file checked
// against its schema and written whole.
import {
  type DataFs,
  joinPath,
  libraryFile,
  writeFileAtomic,
  writeLibraryFiles,
} from "@sprachanker/course-kit";
import { courseIndex, exams, lessons, SERIES } from "./course.ts";
import { localeCourse, localeExam, localeLessons, localeModell } from "./locales.ts";
import { FIXTURE_MEDIA } from "./media.ts";

/** The fixture's series key as a plain string (tests compare with it). */
export const FIXTURE_SERIES: string = SERIES;

/** Writes `<libraryRoot>/sprachanker.fixture/…`; returns the series folder. */
export async function writeFixtureLibrary(fs: DataFs, libraryRoot: string): Promise<string> {
  const series = joinPath(libraryRoot, FIXTURE_SERIES);
  const problems: string[] = [];
  const invalid = await writeLibraryFiles(
    fs,
    series,
    [
      libraryFile.course(courseIndex),
      ...lessons.map(libraryFile.lesson),
      ...exams.map(libraryFile.exam),
      ...(["ru", "en"] as const).flatMap((lang) => [
        libraryFile.localeCourse(localeCourse(lang)),
        ...localeLessons(lang).map(libraryFile.localeLesson),
        libraryFile.localeExam(localeExam(lang)),
        libraryFile.localeExam(localeModell(lang)),
      ]),
    ],
    (line) => problems.push(line),
  );
  if (invalid)
    throw new Error(`the fixture course does not fit its schemas:\n${problems.join("\n")}`);
  for (const [path, { content }] of FIXTURE_MEDIA)
    await writeFileAtomic(fs, joinPath(series, path), content);
  return series;
}
