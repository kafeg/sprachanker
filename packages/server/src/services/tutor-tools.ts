// The tutor's tools on the server side (07, "Tools"): the learner's progress, mistakes, the course's
// words and lessons, looked up when the model asks. Lessons are "unit.lesson" as the app shows them.
import type { LessonProgress } from "@sprachanker/engine";
import { grammarNotes, lessonWords, mistakeLine } from "@sprachanker/llm";
import { type LessonKey, parseLessonKey } from "@sprachanker/schema";
import type { Content } from "./content.ts";
import type { LessonContexts } from "./lesson-context.ts";
import type { Mistakes } from "./mistakes.ts";

const number = (key: string) => {
  const { unit, lesson } = parseLessonKey(key as LessonKey);
  return `${unit}.${lesson}`;
};

/** Words compared without articles, case and the forms after a comma: "die Frau, die Frauen" → "frau". */
const headword = (text: string) =>
  text
    .split(",")[0]
    ?.toLowerCase()
    .replace(/^\(?(der|die|das|ein|eine|sich|etwas|jemand(en|em)?)\)?\s+/g, "")
    .trim() ?? "";

export function createTutorTools(deps: {
  content: Content;
  lessons: LessonContexts;
  mistakes: Mistakes;
  progress: () => Record<string, LessonProgress>;
}) {
  const { content } = deps;

  return {
    /** The tool runner for a tutor chat in this lesson's course and edition. */
    runner(series: string, lessonKey: LessonKey, edition: string) {
      const course = parseLessonKey(lessonKey).courseId;
      const map = content.courseMap(series, course, edition);
      const order = async () => (await map).index.units.flatMap((u) => u.lessons);
      const title = async (key: string) => `${number(key)} ${(await map).titles[key] ?? ""}`.trim();

      async function find(query: unknown): Promise<LessonKey | undefined> {
        const q = String(query ?? "")
          .trim()
          .toLowerCase();
        if (!q) return undefined;
        const keys = await order();
        const titles = (await map).titles;
        return (
          keys.find((k) => number(k) === q) ??
          keys.find((k) => (titles[k] ?? "").toLowerCase().includes(q))
        );
      }

      const tools: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
        async get_progress() {
          const progress = deps.progress();
          const keys = await order();
          const done = await Promise.all(
            keys
              .filter((k) => progress[k]?.status === "done")
              .map(async (k) => ({
                lesson: await title(k),
                bestScore:
                  progress[k]?.bestScore === undefined
                    ? null
                    : Math.round(progress[k].bestScore * 100),
              })),
          );
          const inProgress = await Promise.all(
            keys.filter((k) => progress[k]?.status === "in_progress").map(title),
          );
          return {
            lessons: keys.length,
            done: done.length,
            doneLessons: done,
            inProgress,
            current: await title(lessonKey),
          };
        },

        async get_mistakes({ lesson }) {
          const key = lesson ? await find(lesson) : undefined;
          if (lesson && !key) return { error: `no lesson "${lesson}"` };
          const list = await deps.lessons.mistakes(
            series,
            edition,
            deps.mistakes.list({ lesson: key, limit: 15 }),
            (await map).titles,
          );
          return { mistakes: list.map(mistakeLine) };
        },

        async find_word({ word }) {
          const q = headword(String(word ?? ""));
          if (!q) return { error: "no word" };
          const found: Array<{ lesson: string; word: string; translation?: string }> = [];
          for (const key of await order()) {
            const [lesson, locale] = await Promise.all([
              content.lesson(series, key),
              content.localeLesson(series, key, edition),
            ]);
            for (const v of lesson.vocab) {
              const translation = locale?.vocab[v.key]?.translation;
              if (headword(v.target).includes(q) || translation?.toLowerCase().includes(q)) {
                found.push({ lesson: await title(key), word: v.target, translation });
              }
            }
            if (found.length >= 10) break;
          }
          return found.length ? { found } : { found: [], note: "not in the course vocabulary" };
        },

        async get_lesson({ lesson }) {
          const key = await find(lesson);
          if (!key) return { error: `no lesson "${lesson}"` };
          const ctx = await deps.lessons.get(series, key, edition);
          return {
            lesson: await title(key),
            goals: ctx.info.goals,
            words: lessonWords(ctx.info, 1500),
            grammar: grammarNotes(ctx.info, 1500),
          };
        },
      };

      return async (name: string, args: unknown) => {
        const tool = tools[name];
        if (!tool) return { error: `unknown tool ${name}` };
        return tool((args ?? {}) as Record<string, unknown>);
      };
    },
  };
}
export type TutorTools = ReturnType<typeof createTutorTools>;
