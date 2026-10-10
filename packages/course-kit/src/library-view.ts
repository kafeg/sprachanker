// What the app reads from the library (library.ts implements it over the data folder).
import type {
  CourseIndex,
  EditionId,
  Exam,
  ExamKey,
  Lesson,
  LessonKey,
  LocaleCourse,
  LocaleExam,
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
  /** What a lesson's file (with `edition`, its locale file) is now — its size and time of change, ""
   *  while there is none: a reading kept is good while this stays the same. */
  lessonStamp(series: string, key: LessonKey, edition?: string): string;
  exam(series: string, key: ExamKey): Promise<Exam>;
  localeExam(series: string, key: ExamKey, edition: string): Promise<LocaleExam | undefined>;
  /** The same for an exam's file. */
  examStamp(series: string, key: ExamKey, edition?: string): string;
  /** Absolute file of a media path, or undefined when it does not exist or leaves the media folder. */
  mediaFile(series: string, path: MediaPath | string): string | undefined;
  /** Verifies one installed course: integrity and counts (verify.ts). */
  check(series: string, course: string): Promise<CourseReport>;
}

/** What is wrong with a course, by what the learner can make of it: a media file missing, a file that
 *  does not read, a lesson without its texts in an edition, no edition, or data that do not agree
 *  (keys, units, answers, fingerprints, locale texts). `at`: the file, key or path; `text`: the whole
 *  finding in English (the CLI, a tooltip). */
export interface CourseProblem {
  kind: "missingMedia" | "unreadable" | "noLocale" | "noEdition" | "inconsistent";
  at: string;
  text: string;
}

/** A course as verify finds it (verify.ts). */
export interface CourseReport {
  series: string;
  course: string;
  editions: string[];
  units: number;
  lessons: number;
  exams: number;
  /** Exercises by type. */
  exercises: Record<string, number>;
  /** Items of the exercises and the exams' questions. */
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
  problems: CourseProblem[];
  /** Gaps worth knowing: missing translations, unknown exercises… */
  notes: string[];
}
