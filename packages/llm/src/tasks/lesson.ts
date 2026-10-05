// The lesson as the tasks see it, and the lines of it that go into their prompts. One place, so every
// task shows the lesson the same way.
import { clip, htmlToText, newest } from "../text.ts";

/** What the tasks know of a lesson (the server's lesson context fills it). */
export interface LessonInfo {
  title: string;
  /** In the learner's language, as the course states them. */
  goals: string[];
  /** Grammar pages of the lesson (course HTML). */
  grammarHtml: string[];
  /** Words of this lesson: headword and translation. */
  vocab: Array<{ target: string; translation?: string }>;
}

/** "der Kaffee (coffee)". */
export const wordWithTranslation = (v: LessonInfo["vocab"][number]) =>
  v.translation ? `${v.target} (${v.translation})` : v.target;

export const goalsLine = (lesson: Pick<LessonInfo, "goals">) =>
  lesson.goals.length ? `Goals: ${lesson.goals.join("; ")}` : undefined;

/** The lesson's words with translations, within `max` characters. */
export const lessonWords = (lesson: Pick<LessonInfo, "vocab">, max: number) =>
  clip(lesson.vocab.map(wordWithTranslation).join("; "), max);

export const lessonWordsLine = (lesson: Pick<LessonInfo, "vocab">, max: number) =>
  lesson.vocab.length ? `Words of this lesson: ${lessonWords(lesson, max)}` : undefined;

/** Headwords of earlier lessons (oldest first): the most recent within `max` characters. */
export const knownWordsLine = (knownVocab: string[], max: number) =>
  knownVocab.length ? `Words from earlier lessons: ${newest(knownVocab, max, "; ")}` : undefined;

/** The lesson's grammar notes as plain text within `max` characters. */
export const grammarNotes = (lesson: Pick<LessonInfo, "grammarHtml">, max: number) =>
  clip(lesson.grammarHtml.map(htmlToText).join("\n\n"), max);
