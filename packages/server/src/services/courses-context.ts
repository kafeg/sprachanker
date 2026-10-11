// What the Tutor section's chats know of the learner's courses (07): the courses begun in the language
// a chat practises, the lessons worked on in them with their words and grammar topics, the latest
// mistakes there. Bounded here by count; the task cuts each part to its budget.
import type { CoursesInfo, TutorMistake } from "@sprachanker/llm";
import { type LessonKey, parseEditionId, parseLessonKey } from "@sprachanker/schema";
import { type Content, courseTitle } from "./content.ts";
import type { LessonContexts } from "./lesson-context.ts";
import type { StudiedCourse } from "./lessons.ts";
import type { Mistakes } from "./mistakes.ts";

/** Lessons read for their words and topics (the latest worked on); mistakes listed. */
const LESSONS_READ = 30;
const MISTAKES = 10;

export function createCoursesContext(deps: {
  content: Content;
  lessonContext: LessonContexts;
  /** The courses begun, the latest first (the lessons service). */
  studied: () => Promise<StudiedCourse[]>;
  mistakes: Mistakes;
}) {
  const { content } = deps;
  return {
    /** The edition a new chat practises: the one the course studied last is studied in. */
    async latestEdition(): Promise<string | undefined> {
      return (await deps.studied())[0]?.edition;
    },

    /** What the learner has met in the courses that teach the language `edition` names. */
    async get(edition: string): Promise<CoursesInfo> {
      const target = parseEditionId(edition).target;
      const courses = (await deps.studied()).filter(
        (c) => parseEditionId(c.edition).target === target,
      );
      const installed = await content.courses();
      const maps = await Promise.all(
        courses.map((c) => content.courseMap(c.series, c.course, c.edition).catch(() => undefined)),
      );
      const titleOf = (key: LessonKey, i: number) => maps[i]?.titles[key] ?? key;

      // The latest lessons worked on across those courses, for their words and grammar topics.
      const recent = courses
        .flatMap((c) => c.lessons.map((l) => ({ ...l, course: c })))
        .sort((a, b) => b.lastAt - a.lastAt)
        .slice(0, LESSONS_READ);
      const words: CoursesInfo["words"] = [];
      const grammar: string[] = [];
      for (const { key, course } of recent) {
        const [lesson, locale] = await Promise.all([
          content.lesson(course.series, key).catch(() => undefined),
          content.localeLesson(course.series, key, course.edition),
        ]);
        for (const v of lesson?.vocab ?? [])
          words.push({ target: v.target, translation: locale?.vocab[v.key]?.translation });
        for (const tab of locale?.tabs.grammar ?? [])
          if (tab.title && !grammar.includes(tab.title)) grammar.push(tab.title);
      }

      // The latest mistakes in those courses, newest first, each named by its lesson.
      const mistakes: TutorMistake[] = [];
      for (const m of deps.mistakes.list()) {
        if (mistakes.length >= MISTAKES) break;
        const i = courses.findIndex((c) => c.key === parseLessonKey(m.lessonKey).course);
        const c = courses[i];
        if (!c) continue;
        mistakes.push(
          ...(await deps.lessonContext.mistakes(c.series, c.edition, [m], maps[i]?.titles ?? {})),
        );
      }

      return {
        courses: courses.map((c, i) => {
          const summary = installed.find((s) => s.key === c.key);
          return {
            title: (summary && courseTitle(summary, [c.edition])) ?? c.key,
            done: c.lessons.filter((l) => l.done).length,
            lessons: summary?.lessons.length ?? c.lessons.length,
            worked: c.lessons.map((l) => titleOf(l.key, i)),
          };
        }),
        words: dedupe(words),
        grammar,
        mistakes,
      };
    },
  };
}
export type CoursesContext = ReturnType<typeof createCoursesContext>;

/** A word met in several lessons, once (where it was met last). */
const dedupe = (words: CoursesInfo["words"]) => {
  const seen = new Set<string>();
  return words.filter((w) => !seen.has(w.target) && seen.add(w.target));
};
