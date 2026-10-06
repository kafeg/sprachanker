// What the app reads from the library (library.ts implements it over the data folder).
import type {
  CourseIndex,
  EditionId,
  Lesson,
  LessonKey,
  LocaleCourse,
  LocaleLesson,
  MediaPath,
} from "@sprachanker/schema";
export interface InstalledCourse {
  series: string;
  /** Course id inside the series (`a1`). */
  course: string;
  editions: EditionId[];
}

export interface LibraryView {
  root: string;
  courses(): InstalledCourse[];
  courseIndex(series: string, course: string): Promise<CourseIndex>;
  localeCourse(series: string, course: string, edition: string): Promise<LocaleCourse | undefined>;
  lesson(series: string, key: LessonKey): Promise<Lesson>;
  localeLesson(series: string, key: LessonKey, edition: string): Promise<LocaleLesson | undefined>;
  /** Absolute file of a media path, or undefined when it does not exist or leaves the media folder. */
  mediaFile(series: string, path: MediaPath | string): string | undefined;
  /** Verifies one installed course: integrity and counts (verify.ts). */
  check(series: string, course: string): Promise<CourseReport>;
}

/** A course as verify finds it (verify.ts). */
export interface CourseReport {
  series: string;
  course: string;
  editions: string[];
  units: number;
  lessons: number;
  /** Exercises by type. */
  exercises: Record<string, number>;
  items: number;
  vocab: number;
  media: {
    referenced: number;
    missing: number;
    /** Files on disk by kind (audio, video, image, pdf, subtitles): present and missing. */
    byKind: Record<string, { present: number; missing: number }>;
    /** Bytes of the referenced files on disk. */
    bytes: number;
  };
  /** Broken data: the app would fail or show something wrong. */
  problems: string[];
  /** Gaps worth knowing: missing translations, unknown exercises… */
  notes: string[];
}
