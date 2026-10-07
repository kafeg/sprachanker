// What the LLM tasks know about a lesson (07): the lesson in the learner's edition, earlier lessons as
// words and titles, and mistakes with their exercises. Shared by the tutor, writing and scenes.
import type { VocabWord } from "@sprachanker/engine";
import type { LessonInfo, TutorMistake } from "@sprachanker/llm";
import {
  findExercise,
  type Lang,
  type Lesson,
  type LessonKey,
  type LocaleLesson,
  parseEditionId,
  parseLessonKey,
} from "@sprachanker/schema";
import type { Content } from "./content.ts";
import type { Mistake } from "./mistakes.ts";

export interface LessonContext {
  lesson: Lesson;
  locale?: LocaleLesson;
  target: Lang;
  /** The `lesson` part of the tasks' inputs. */
  info: LessonInfo;
  /** Headwords and titles of the lessons before this one, in course order. */
  knownVocab: string[];
  earlierLessons: string[];
  /** Lesson titles of the edition, by key. */
  titles: Record<string, string>;
}

export function createLessonContext(content: Content) {
  return {
    async get(series: string, lessonKey: LessonKey, edition: string): Promise<LessonContext> {
      const course = parseLessonKey(lessonKey).courseId;
      const [map, lesson, locale] = await Promise.all([
        content.courseMap(series, course, edition),
        content.lesson(series, lessonKey),
        content.localeLesson(series, lessonKey, edition),
      ]);
      const order = map.index.units.flatMap((u) => u.lessons);
      const earlier = order.slice(0, Math.max(0, order.indexOf(lessonKey)));
      const earlierVocab = await Promise.all(
        earlier.map(async (k) => (await content.lesson(series, k)).vocab.map((v) => v.target)),
      );
      return {
        lesson,
        locale,
        target: parseEditionId(edition).target,
        info: {
          title: locale?.title ?? lessonKey,
          goals: lesson.goals.flatMap((g) => map.locale?.goals[g]?.text ?? []),
          grammarHtml: locale?.tabs.grammar.map((t) => t.bodyHtml) ?? [],
          vocab: lesson.vocab.map((v) => ({
            target: v.target,
            translation: locale?.vocab[v.key]?.translation,
          })),
        },
        knownVocab: [...new Set(earlierVocab.flat())],
        earlierLessons: earlier.map((k) => map.titles[k] ?? k),
        titles: map.titles,
      };
    },

    /** The course's words with their forms and translations in the edition: those met up to the
     *  lesson (it included) and those of later lessons, each in course order. */
    async vocabulary(series: string, lessonKey: LessonKey, edition: string) {
      const course = parseLessonKey(lessonKey).courseId;
      const map = await content.courseMap(series, course, edition);
      const order = map.index.units.flatMap((u) => u.lessons);
      const words = await Promise.all(
        order.map(async (key): Promise<VocabWord[]> => {
          const [lesson, locale] = await Promise.all([
            content.lesson(series, key).catch(() => undefined),
            content.localeLesson(series, key, edition),
          ]);
          return (lesson?.vocab ?? []).map((v) => ({
            target: v.target,
            plural: v.plural,
            forms: v.forms,
            translation: locale?.vocab[v.key]?.translation,
          }));
        }),
      );
      const at = order.indexOf(lessonKey) + 1;
      return { upTo: words.slice(0, at).flat(), later: words.slice(at).flat() };
    },

    /** Mistakes with their exercises as the edition shows them; items no longer in the course are
     *  skipped. With `titles`, each names its lesson. */
    async mistakes(
      series: string,
      edition: string,
      list: Mistake[],
      titles?: Record<string, string>,
    ): Promise<TutorMistake[]> {
      const out: TutorMistake[] = [];
      for (const m of list) {
        const key = m.lessonKey as LessonKey;
        const [lesson, locale] = await Promise.all([
          content.lesson(series, key).catch(() => undefined),
          content.localeLesson(series, key, edition),
        ]);
        const exercise = lesson && findExercise(lesson, m.exerciseKey);
        if (!exercise?.items[m.index]) continue;
        out.push({
          lesson: titles ? (titles[m.lessonKey] ?? m.lessonKey) : undefined,
          exercise,
          locale: locale?.exercises[exercise.key],
          index: m.index,
          answer: m.answer,
          fixed: m.fixed,
        });
      }
      return out;
    },
  };
}
export type LessonContexts = ReturnType<typeof createLessonContext>;

/** "Exercise 3 · Title": how the model is told which exercise a message was written on. */
export function exerciseLabel(lesson: Lesson, locale: LocaleLesson | undefined, key: string) {
  const n = lesson.pages.findIndex((p) => p.exercise.key === key);
  const exercise = lesson.pages[n]?.exercise;
  if (!exercise) return undefined;
  const title = locale?.exercises[exercise.key]?.title;
  return `Exercise ${n + 1}${title ? ` · ${title}` : ""}`;
}
