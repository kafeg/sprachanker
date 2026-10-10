// Installed course content for the API: course list, course map, lessons (cached while their files
// stay the same).
import type { LibraryView } from "@sprachanker/course-kit";
import type {
  CourseIndex,
  CourseSource,
  Exam,
  ExamKey,
  Lesson,
  LessonKey,
  LocaleCourse,
  LocaleExam,
  LocaleLesson,
} from "@sprachanker/schema";

export interface CourseSummary {
  series: string;
  course: string;
  key: string;
  editions: string[];
  titles: Record<string, string>;
  /** Lesson keys in course order. */
  lessons: string[];
  /** Exam keys, in the course index's order. */
  exams: string[];
  /** A course of exams only is shown in the Exams section, not among the courses (01). */
  kind: "course" | "exam";
  /** Where the course comes from (02). */
  source: CourseSource | null;
}

export interface CourseMap {
  index: CourseIndex;
  locale: LocaleCourse | null;
  /** Lesson titles of the edition, by lesson key. */
  titles: Record<string, string>;
}

export function createContent(library: LibraryView) {
  type Kept<T> = { stamp: string; value: Promise<T> };
  const lessons = new Map<string, Kept<Lesson>>();
  const locales = new Map<string, Kept<LocaleLesson | undefined>>();
  /** Reads once and keeps the result while its file stays the same — replaced by a download, an import
   *  from the command line or a series folder copied back, it is read again; a failed read is not
   *  kept (asked again next time). */
  const cached = <T>(
    cache: Map<string, Kept<T>>,
    id: string,
    stamp: string,
    read: () => Promise<T>,
  ) => {
    const kept = cache.get(id);
    if (kept?.stamp === stamp) return kept.value;
    const value = read();
    cache.set(id, { stamp, value });
    value.catch(() => {
      if (cache.get(id)?.value === value) cache.delete(id);
    });
    return value;
  };
  const lesson = (series: string, key: LessonKey) =>
    cached(lessons, `${series}|${key}`, library.lessonStamp(series, key), () =>
      library.lesson(series, key),
    );
  const exams = new Map<string, Kept<Exam>>();
  const localeExams = new Map<string, Kept<LocaleExam | undefined>>();
  const exam = (series: string, key: ExamKey) =>
    cached(exams, `${series}|${key}`, library.examStamp(series, key), () =>
      library.exam(series, key),
    );
  const localeExam = (series: string, key: ExamKey, edition: string) =>
    cached(
      localeExams,
      `${series}|${key}|${edition}`,
      library.examStamp(series, key, edition),
      () => library.localeExam(series, key, edition),
    );
  const localeLesson = (series: string, key: LessonKey, edition: string) =>
    cached(locales, `${series}|${key}|${edition}`, library.lessonStamp(series, key, edition), () =>
      library.localeLesson(series, key, edition),
    );

  return {
    lesson,
    localeLesson,
    exam,
    localeExam,
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
            const lessons = index.units.flatMap((u) => u.lessons);
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
      for (const key of index.units.flatMap((u) => u.lessons)) {
        const loc = await localeLesson(series, key, edition);
        if (loc) titles[key] = loc.title;
      }
      return { index, locale, titles };
    },
  };
}
export type Content = ReturnType<typeof createContent>;
