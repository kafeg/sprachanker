// What the LLM tasks know about a lesson (07): the lesson in the learner's edition, earlier lessons as
// words and titles, and mistakes with their exercises; the course's vocabulary. Shared by the tutor
// (and its tools), writing, scenes, explain, speaking and word examples.
import { type VocabWord, wrongParts } from "@sprachanker/engine";
import { type LessonInfo, speakersOf, type TutorMistake } from "@sprachanker/llm";
import {
  findExercise,
  type Lang,
  type Lesson,
  type LessonKey,
  type LocaleLesson,
  lessonOrder,
  parseEditionId,
  parseLessonKey,
} from "@sprachanker/schema";
import type { Content } from "./content.ts";
import type { Mistake } from "./mistakes.ts";

interface LessonContext {
  lesson: Lesson;
  locale?: LocaleLesson;
  target: Lang;
  /** The `lesson` part of the tasks' inputs, with what the learner knows by now (07). */
  info: LessonInfo;
  /** Titles of the lessons before this one, in course order. */
  earlierLessons: string[];
  /** Lesson titles of the edition, by key. */
  titles: Record<string, string>;
}

/** Earlier words kept in a snapshot: the latest; every task's budget takes fewer. */
const KNOWN_WORDS = 800;
/** The course's people kept in a snapshot: the latest met. */
const CHARACTERS = 30;

/** The CEFR level a course's id or a deck's name says ("a1-ru" → A1, "a1-a2-ru" and "A1A2" → A1–A2,
 *  "Deutsch A2", "слова_b1"), a range low to high ("B1 + A2" → A2–B1); undefined when it says none.
 *  Several names joined say the range of them all. */
export function levelOf(name: string): string | undefined {
  const levels = [...name.matchAll(/(?<![a-z])([abc][12])(?![0-9])/gi)]
    .map((m) => (m[1] as string).toUpperCase())
    .sort();
  const [low, high] = [levels[0], levels.at(-1)];
  return low && high && high !== low ? `${low}–${high}` : low;
}

/** A word as the tasks see it, in an edition. */
const wordsOf = (lesson: Lesson | undefined, locale: LocaleLesson | undefined) =>
  (lesson?.vocab ?? []).map((v) => ({
    target: v.target,
    translation: locale?.vocab[v.key]?.translation,
  }));

/** Each once, where it came first. */
const once = <T>(list: T[], key: (t: T) => string) => {
  const seen = new Set<string>();
  return list.filter((t) => !seen.has(key(t)) && seen.add(key(t)));
};

/** Each once, where it came last (a word taught again is as recent as its latest lesson). */
const latest = <T>(list: T[], key: (t: T) => string) => once([...list].reverse(), key).reverse();

export function createLessonContext(content: Content) {
  return {
    /** The lesson in the edition with the knowledge snapshot (07, "What the learner knows by
     *  now"): the course's level, the lesson's place, its goals and words, the earlier lessons'
     *  words with translations and the grammar topics met so far. */
    async get(series: string, lessonKey: LessonKey, edition: string): Promise<LessonContext> {
      const course = parseLessonKey(lessonKey).courseId;
      const [map, lesson, locale] = await Promise.all([
        content.courseMap(series, course, edition),
        content.lesson(series, lessonKey),
        content.localeLesson(series, lessonKey, edition),
      ]);
      const order = lessonOrder(map.index);
      const at = order.indexOf(lessonKey);
      const earlier = order.slice(0, Math.max(0, at));
      const files = await Promise.all(
        earlier.map(async (k) => {
          const [l, loc] = await Promise.all([
            content.lesson(series, k).catch(() => undefined),
            content.localeLesson(series, k, edition).catch(() => undefined),
          ]);
          return { lesson: l, locale: loc };
        }),
      );
      const known = latest(
        files.flatMap((f) => wordsOf(f.lesson, f.locale)),
        (w) => w.target,
      );
      // Each topic once in each lesson that taught it (a page of the same title twice in a lesson
      // once): "unit.lesson" as the app names lessons, and the title.
      const topics = once(
        [...files.map((f) => f.locale), locale].flatMap((loc, i) => {
          const key = [...earlier, lessonKey][i] as LessonKey;
          const { unit, lesson: n } = parseLessonKey(key);
          return (loc?.tabs.grammar ?? []).flatMap((t) =>
            t.title?.trim()
              ? [{ title: t.title.trim(), lesson: `${unit}.${n}`, lessonTitle: map.titles[key] }]
              : [],
          );
        }),
        (t) => `${t.title}
${t.lesson}`,
      );
      const unit = map.index.units.find((u) => u.lessons.includes(lessonKey));
      const level = levelOf(course);
      // The course's people met so far: its scripts' speakers, the latest last — a label that is a
      // word met so far ("Kellnerin") a role, no name.
      const met = [...known, ...wordsOf(lesson, locale)].map((w) => w.target);
      const characters = latest(
        [...files.map((f) => f.locale), locale].flatMap((loc) =>
          loc?.tabs.script ? speakersOf(loc.tabs.script.bodyHtml, met) : [],
        ),
        (name) => name,
      ).slice(-CHARACTERS);
      return {
        lesson,
        locale,
        target: parseEditionId(edition).target,
        info: {
          title: locale?.title ?? lessonKey,
          goals: lesson.goals.flatMap((g) => map.locale?.goals[g]?.text ?? []),
          grammarHtml: locale?.tabs.grammar.map((t) => t.bodyHtml) ?? [],
          vocab: wordsOf(lesson, locale),
          ...(level && { level }),
          ...(at >= 0 && {
            place: {
              n: at + 1,
              of: order.length,
              ...(unit &&
                map.locale?.units[unit.key]?.title && {
                  unit: map.locale.units[unit.key]?.title,
                }),
            },
          }),
          knownWords: known.slice(-KNOWN_WORDS),
          topics,
          ...(characters.length && { characters }),
        },
        earlierLessons: earlier.map((k) => map.titles[k] ?? k),
        titles: map.titles,
      };
    },

    /** The course's words with their forms and translations in the edition: those met up to the
     *  lesson (it included) and those of later lessons, each in course order. */
    async vocabulary(series: string, lessonKey: LessonKey, edition: string) {
      const course = parseLessonKey(lessonKey).courseId;
      const map = await content.courseMap(series, course, edition);
      const order = lessonOrder(map.index);
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

    /** Mistakes with their exercises as the edition shows them, each with its wrong parts only (a
     *  gap of many, a pair, the choice); items no longer in the course are skipped. With `titles`,
     *  each names its lesson. */
    async mistakes(
      series: string,
      edition: string,
      list: Mistake[],
      titles?: Record<string, string>,
    ): Promise<TutorMistake[]> {
      const target = parseEditionId(edition).target;
      const out: TutorMistake[] = [];
      for (const m of list) {
        const key = m.lessonKey as LessonKey;
        const [lesson, locale] = await Promise.all([
          content.lesson(series, key).catch(() => undefined),
          content.localeLesson(series, key, edition),
        ]);
        const exercise = lesson && findExercise(lesson, m.exerciseKey);
        if (!exercise?.items[m.index]) continue;
        const mistake = {
          itemKey: m.itemKey,
          exercise,
          locale: locale?.exercises[exercise.key],
          index: m.index,
          answer: m.answer,
          ...(m.corrected !== undefined && { corrected: m.corrected }),
        };
        out.push({
          ...mistake,
          lesson: titles ? (titles[m.lessonKey] ?? m.lessonKey) : undefined,
          parts: wrongParts(mistake, target),
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
