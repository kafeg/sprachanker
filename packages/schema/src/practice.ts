// A course's AI practice (owner, 2026-10-14): each lesson's Reading and Listening texts with their
// questions, writing tasks with the message to answer and Speaking tasks, made by the text generator
// and kept with the course in the library and its bundles — every variant ever made for a lesson, of
// every step, so they gather: a course-wide run, a lesson's or a step's button and the command line
// all add variants here. A learner's step takes the next variant they have not had; checking what
// they write or say stays the model's. The texts to hear and the partners' lines are recorded when
// made, so a course studies without a voice engine. Beside the course:
// `practice/<edition>/<course>/<unit>-<lesson>.json`, its recordings in the lesson's folder there.
import { z } from "zod";
import { TalkTask, UnderstandingText, WritingTask } from "./assistant.ts";
import { format, PracticeId } from "./common.ts";
import { LessonKey, parseLessonKey } from "./keys.ts";
import { EditionId, Lang } from "./lang.ts";

export const PRACTICE_FORMAT = 1;

/** When a variant was made and by which model. */
const Made = { id: PracticeId, model: z.string().max(200), madeAt: z.number() };

export const PracticeText = z.strictObject({ ...Made, text: UnderstandingText });
export const PracticeWriting = z.strictObject({ ...Made, task: WritingTask });
export const PracticeSpeaking = z.strictObject({ ...Made, task: TalkTask });
export type PracticeText = z.infer<typeof PracticeText>;
export type PracticeWriting = z.infer<typeof PracticeWriting>;
export type PracticeSpeaking = z.infer<typeof PracticeSpeaking>;

/** A lesson's practice in an edition: each step's variants, oldest first. */
export const PracticeLesson = z.strictObject({
  format: format(PRACTICE_FORMAT),
  lesson: LessonKey,
  edition: EditionId,
  /** The learner's language of its titles, questions, tasks and glosses: the edition's. */
  language: Lang,
  reading: z.array(PracticeText).max(200),
  listening: z.array(PracticeText).max(200),
  writing: z.array(PracticeWriting).max(200),
  speaking: z.array(PracticeSpeaking).max(200),
});
export type PracticeLesson = z.infer<typeof PracticeLesson>;

/** Where a lesson's practice recording `name` goes: its path in the series folder. */
export function practiceRecordingPath(lessonKey: LessonKey, edition: string, name: string) {
  const { courseId, name: lesson } = parseLessonKey(lessonKey);
  return `practice/${edition}/${courseId}/${lesson}/${name}.wav`;
}

/** The recordings a lesson's practice names: its texts to hear, its partners' lines. */
export const practiceRecordings = (lesson: PracticeLesson): string[] => [
  ...lesson.listening.flatMap((v) => (v.text.recording ? [v.text.recording] : [])),
  ...lesson.speaking.flatMap((v) =>
    v.task.kind === "roleplay" ? Object.values(v.task.recordings ?? {}) : [],
  ),
];

/** Two practices of one lesson as one: every variant of either, each once by its id (the first
 *  kept), oldest first. */
export function mergePractice(a: PracticeLesson, b: PracticeLesson): PracticeLesson {
  const merge = <T extends { id: string; madeAt: number }>(x: T[], y: T[]) => {
    const seen = new Set(x.map((v) => v.id));
    return [...x, ...y.filter((v) => !seen.has(v.id))].sort((p, q) => p.madeAt - q.madeAt);
  };
  return {
    ...a,
    reading: merge(a.reading, b.reading),
    listening: merge(a.listening, b.listening),
    writing: merge(a.writing, b.writing),
    speaking: merge(a.speaking, b.speaking),
  };
}
