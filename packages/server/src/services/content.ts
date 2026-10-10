// Installed course content for the API: course list, course map, lessons (cached while their files
// stay the same).
import type { LibraryView } from "@sprachanker/course-kit/view";
import {
  type CourseIndex,
  type CourseSource,
  type Exam,
  type ExamKey,
  type ExamSources,
  type Lesson,
  type LessonKey,
  type LocaleCourse,
  type LocaleExam,
  type LocaleLesson,
  lessonOrder,
} from "@sprachanker/schema";
import { createOnce } from "../once.ts";

interface CourseSummary {
  series: string;
  course: string;
  key: string;
  editions: string[];
  titles: Record<string, string>;
  /** Lesson keys in course order. */
  lessons: LessonKey[];
  /** Exam keys, in the course index's order. */
  exams: ExamKey[];
  /** A course of exams only is shown in the Exams section, not among the courses (01). */
  kind: "course" | "exam";
  /** Where the course comes from (02). */
  source: CourseSource | null;
}

/** A course's title in the first of `editions` that has one (the edition its runs or cards are in),
 *  else in its first edition that has one. */
export const courseTitle = (course: CourseSummary, editions: readonly (string | null)[]) =>
  [...editions, ...course.editions].map((e) => e && course.titles[e]).find(Boolean) ?? null;

interface CourseMap {
  index: CourseIndex;
  locale: LocaleCourse | null;
  /** Lesson titles of the edition, by lesson key. */
  titles: Record<string, string>;
}

export function createContent(library: LibraryView) {
  /** Each read once and kept while its file stays the same (its stamp) — replaced by a download, an
   *  import from the command line or a series folder copied back, it is read again; a failed read is
   *  not kept (asked again next time). */
  const lessons = createOnce<Lesson>({ keep: true });
  const locales = createOnce<LocaleLesson | undefined>({ keep: true });
  const exams = createOnce<Exam>({ keep: true });
  const localeExams = createOnce<LocaleExam | undefined>({ keep: true });
  // An exam's sources are written with its file: kept while the exam's file stays the same.
  const examSourcesKept = createOnce<ExamSources | undefined>({ keep: true });
  const lesson = (series: string, key: LessonKey) =>
    lessons(
      `${series}|${key}`,
      () => library.lesson(series, key),
      library.lessonStamp(series, key),
    );
  const exam = (series: string, key: ExamKey) =>
    exams(`${series}|${key}`, () => library.exam(series, key), library.examStamp(series, key));
  const localeExam = (series: string, key: ExamKey, edition: string) =>
    localeExams(
      `${series}|${key}|${edition}`,
      () => library.localeExam(series, key, edition),
      library.examStamp(series, key, edition),
    );
  const examSources = (series: string, key: ExamKey) =>
    examSourcesKept(
      `${series}|${key}`,
      () => library.examSources(series, key),
      library.examStamp(series, key),
    );
  const localeLesson = (series: string, key: LessonKey, edition: string) =>
    locales(
      `${series}|${key}|${edition}`,
      () => library.localeLesson(series, key, edition),
      library.lessonStamp(series, key, edition),
    );

  return {
    lesson,
    localeLesson,
    exam,
    localeExam,
    examSources,
    /** A lesson with its locale file of an edition (null when the edition has none). */
    async lessonWithLocale(series: string, key: LessonKey, edition: string) {
      const [l, locale] = await Promise.all([
        lesson(series, key),
        localeLesson(series, key, edition),
      ]);
      return { lesson: l, locale };
    },
    /** The installed courses; one whose files do not read is left out (and logged): the others still
     *  list, and the catalogue offers it again to download. */
    async courses(): Promise<CourseSummary[]> {
      const all = await Promise.all(
        library.courses().map(async ({ series, course, editions }) => {
          try {
            const index = await library.courseIndex(series, course);
            const titles: Record<string, string> = {};
            for (const edition of editions) {
              const locale = await library.localeCourse(series, course, edition);
              if (locale) titles[edition] = locale.title;
            }
            const lessons = lessonOrder(index);
            return {
              series,
              course,
              key: index.key,
              editions,
              titles,
              lessons,
              exams: index.exams,
              kind: !lessons.length && index.exams.length ? ("exam" as const) : ("course" as const),
              source: index.source ?? null,
            };
          } catch (error) {
            console.error(`${series}/${course} does not read; left out: ${String(error)}`);
            return undefined;
          }
        }),
      );
      return all.filter((c) => c !== undefined);
    },
    async courseMap(series: string, course: string, edition: string): Promise<CourseMap> {
      const index = await library.courseIndex(series, course);
      const locale = (await library.localeCourse(series, course, edition)) ?? null;
      const titles: Record<string, string> = {};
      for (const key of lessonOrder(index)) {
        const loc = await localeLesson(series, key, edition);
        if (loc) titles[key] = loc.title;
      }
      return { index, locale, titles };
    },
  };
}
export type Content = ReturnType<typeof createContent>;
