// Installed course content for the API: course list, course map, lessons (cached; files are immutable
// until an import or sync replaces them — a sync calls `forget` for its course).
import type { LibraryView } from "@sprachanker/course-kit";
import type {
  CourseIndex,
  CourseSource,
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
  const lessons = new Map<string, Promise<Lesson>>();
  const locales = new Map<string, Promise<LocaleLesson | undefined>>();
  /** Reads once and keeps the result; a failed read is not kept (asked again next time). */
  const cached = <T>(cache: Map<string, Promise<T>>, id: string, read: () => Promise<T>) => {
    let value = cache.get(id);
    if (!value) {
      value = read();
      cache.set(id, value);
      value.catch(() => cache.delete(id));
    }
    return value;
  };
  const lesson = (series: string, key: LessonKey) =>
    cached(lessons, `${series}|${key}`, () => library.lesson(series, key));
  const localeLesson = (series: string, key: LessonKey, edition: string) =>
    cached(locales, `${series}|${key}|${edition}`, () =>
      library.localeLesson(series, key, edition),
    );

  return {
    lesson,
    localeLesson,
    /** A lesson with its locale file of an edition (null when the edition has none). */
    async lessonWithLocale(series: string, key: LessonKey, edition: string) {
      const [l, locale] = await Promise.all([
        lesson(series, key),
        localeLesson(series, key, edition),
      ]);
      return { lesson: l, locale };
    },
    /** Drops the cached lessons of a course whose files were replaced. */
    forget(series: string, course: string) {
      const prefix = `${series}|${series}/${course}/`;
      for (const cache of [lessons, locales])
        for (const id of cache.keys()) if (id.startsWith(prefix)) cache.delete(id);
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
