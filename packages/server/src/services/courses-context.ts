// What the Tutor section's chats know of the learner's courses (07): the courses begun in the language
// a chat practises, the lessons worked on in them with their words and grammar topics, the latest
// mistakes there. Bounded here by count — only the latest lessons are read, and only their runs for
// mistakes —; the task cuts each part to its budget.
import type { CoursesInfo, TutorMistake } from "@sprachanker/llm";
import { type LessonKey, lessonOrder, parseEditionId } from "@sprachanker/schema";
import type { Content } from "./content.ts";
import type { LessonContexts } from "./lesson-context.ts";
import type { StudiedCourse } from "./lessons.ts";
import type { Mistakes } from "./mistakes.ts";

/** Lessons read for their words, topics and mistakes (the latest worked on, across the courses);
 *  lessons named per course (its latest); mistakes listed. */
const LESSONS_READ = 12;
const LESSONS_NAMED = 8;
const MISTAKES = 10;

export function createCoursesContext(deps: {
  content: Content;
  lessonContext: LessonContexts;
  /** The courses begun, the latest first (the lessons service). */
  studied: () => Promise<StudiedCourse[]>;
  mistakes: Mistakes;
}) {
  const { content } = deps;

  /** A course's edition for the chat: the chat's own when the course has it (the translations in the
   *  chat's language), else the one it is studied in. */
  const editionFor = async (c: StudiedCourse, chat: string) =>
    c.edition === chat ||
    (await content.localeCourse(c.series, c.course, chat).catch(() => undefined))
      ? chat
      : c.edition;

  /** What the learner has met in `studied`'s courses that teach the language `edition` names. */
  async function info(studied: StudiedCourse[], edition: string): Promise<CoursesInfo> {
    const target = parseEditionId(edition).target;
    const courses = await Promise.all(
      studied
        .filter((c) => parseEditionId(c.edition).target === target)
        .map(async (c) => ({ ...c, edition: await editionFor(c, edition) })),
    );
    type Course = (typeof courses)[number];
    /** A lesson's own files in the course's edition (undefined: no longer installed). */
    const read = async (course: Course, key: LessonKey) => {
      const [lesson, locale] = await Promise.all([
        content.lesson(course.series, key).catch(() => undefined),
        content.localeLesson(course.series, key, course.edition).catch(() => undefined),
      ]);
      return { lesson, locale };
    };

    // The latest lessons worked on across those courses, for their words, topics and mistakes.
    const recent = courses
      .flatMap((course) => course.lessons.map((l) => ({ ...l, course })))
      .sort((a, b) => b.lastAt - a.lastAt)
      .slice(0, LESSONS_READ);
    const files = await Promise.all(recent.map((l) => read(l.course, l.key)));
    const words: CoursesInfo["words"] = [];
    const grammar: string[] = [];
    for (const { lesson, locale } of files) {
      for (const v of lesson?.vocab ?? [])
        words.push({ target: v.target, translation: locale?.vocab[v.key]?.translation });
      for (const tab of locale?.tabs.grammar ?? [])
        if (tab.title && !grammar.includes(tab.title)) grammar.push(tab.title);
    }

    // Each course with the titles of its latest lessons; the lessons read above are titled already.
    const titles: Record<string, string> = {};
    recent.forEach((l, i) => {
      const title = files[i]?.locale?.title;
      if (title) titles[l.key] = title;
    });
    const listed = await Promise.all(
      courses.map(async (course) => {
        const named = course.lessons.slice(0, LESSONS_NAMED);
        await Promise.all(
          named
            .filter((l) => !(l.key in titles))
            .map(async (l) => {
              const title = (await read(course, l.key)).locale?.title;
              if (title) titles[l.key] = title;
            }),
        );
        const [index, locale] = await Promise.all([
          content.courseIndex(course.series, course.course).catch(() => undefined),
          content.localeCourse(course.series, course.course, course.edition).catch(() => undefined),
        ]);
        return {
          title: locale?.title ?? course.key,
          done: course.lessons.filter((l) => l.done).length,
          lessons: index ? lessonOrder(index).length : course.lessons.length,
          worked: named.map((l) => titles[l.key] ?? l.key),
        };
      }),
    );

    // The latest mistakes in those lessons, newest first, each named by its lesson.
    const courseOf = new Map(recent.map((l) => [l.key as string, l.course]));
    const mistakes: TutorMistake[] = [];
    for (const m of deps.mistakes.list({ lessons: recent.map((l) => l.key) })) {
      if (mistakes.length >= MISTAKES) break;
      const c = courseOf.get(m.lessonKey);
      if (c)
        mistakes.push(...(await deps.lessonContext.mistakes(c.series, c.edition, [m], titles)));
    }

    return { courses: listed, words: dedupe(words), grammar, mistakes };
  }

  return {
    /** Whether a new chat can begin: a course begun (what it would practise). */
    async begun(): Promise<boolean> {
      return (await deps.studied()).length > 0;
    },

    /**
     * What a chat knows: the edition it practises — `edition`, a chat's own, or for a new one the
     * edition the course studied last is studied in (none begun: undefined) — and what the learner has
     * met in the courses of its language. The courses begun are read once for both.
     */
    async get(edition?: string): Promise<{ edition: string; courses: CoursesInfo } | undefined> {
      const studied = await deps.studied();
      const practised = edition ?? studied[0]?.edition;
      return practised
        ? { edition: practised, courses: await info(studied, practised) }
        : undefined;
    },
  };
}
export type CoursesContext = ReturnType<typeof createCoursesContext>;

/** A word met in several lessons, once (where it was met last). */
const dedupe = (words: CoursesInfo["words"]) => {
  const seen = new Set<string>();
  return words.filter((w) => !seen.has(w.target) && seen.add(w.target));
};
