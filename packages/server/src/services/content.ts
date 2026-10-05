// Installed course content for the API: course list, course map, lessons (cached; files are immutable
// until an import or update replaces them).
import type { LibraryView } from "@sprachanker/course-kit";
import type {
  CourseIndex,
  Lesson,
  LessonKey,
  LocaleCourse,
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
}

export interface CourseMap {
  index: CourseIndex;
  locale: LocaleCourse | null;
  /** Lesson titles of the edition, by lesson key. */
  titles: Record<string, string>;
}

export function createContent(library: LibraryView) {
  const lessons = new Map<string, Promise<Lesson>>();
  const locales = new Map<string, Promise<LocaleLesson | undefined>>();
  const lesson = (series: string, key: LessonKey) => {
    const id = `${series}|${key}`;
    if (!lessons.has(id)) lessons.set(id, library.lesson(series, key));
    return lessons.get(id) as Promise<Lesson>;
  };
  const localeLesson = (series: string, key: LessonKey, edition: string) => {
    const id = `${series}|${key}|${edition}`;
    if (!locales.has(id)) locales.set(id, library.localeLesson(series, key, edition));
    return locales.get(id) as Promise<LocaleLesson | undefined>;
  };

  return {
    lesson,
    localeLesson,
    async courses(): Promise<CourseSummary[]> {
      return Promise.all(
        library.courses().map(async ({ series, course, editions }) => {
          const index = await library.courseIndex(series, course);
          const titles: Record<string, string> = {};
          for (const edition of editions) {
            const locale = await library.localeCourse(series, course, edition);
            if (locale) titles[edition] = locale.title;
          }
          const lessons = index.units.flatMap((u) => u.lessons);
          return { series, course, key: index.key, editions, titles, lessons };
        }),
      );
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
