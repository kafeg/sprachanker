// The lesson's AI practice ready ahead: as a lesson starts, each step whose place is on — Reading,
// Listening, Writing, Speaking — takes its next variant of the course's practice the learner has not
// had (no model needed); none left, the step keeps its latest (owner, 2026-10-15: a lesson makes
// nothing, its practice is made for the course). One lesson after another for the profile. A step
// whose latest work is still untouched is left as it is. Failures are only logged.
import { type Lang, parseEditionId } from "@sprachanker/schema";
import type { LessonStart } from "./lessons.ts";
import type { Settings } from "./settings.ts";
import type { Talk } from "./talk.ts";
import type { Understanding } from "./understanding.ts";
import type { Writing } from "./writing.ts";

export function createPracticePrep(deps: {
  understanding: Understanding;
  writing: Writing;
  talk: Talk;
  settings: Settings;
}) {
  const { understanding, writing, talk, settings } = deps;
  /** The profile's queue: one lesson's work after another's. */
  let queue: Promise<void> = Promise.resolve();
  /** Lessons queued and not yet done, so a lesson opened twice is taken for once. */
  const queued = new Set<string>();

  async function prepare(lesson: LessonStart) {
    const off = settings.value("llm.offIn");
    const language: Lang = settings.value("uiLanguage") ?? parseEditionId(lesson.edition).source;
    const request = { ...lesson, language };
    if (!off.includes("understanding")) {
      await understanding.prepare({ ...request, step: "reading" });
      await understanding.prepare({ ...request, step: "listening" });
    }
    if (!off.includes("writing")) await writing.prepare(request);
    if (!off.includes("scene")) await talk.prepare(request);
  }

  return {
    /** A lesson started: its steps' next variants queued to be taken. */
    lessonStarted(lesson: LessonStart) {
      if (queued.has(lesson.lessonKey)) return;
      queued.add(lesson.lessonKey);
      queue = queue
        .then(() => prepare(lesson))
        .catch((error: unknown) => {
          console.warn(`practice taken as the lesson started: ${(error as Error).message}`);
        })
        .finally(() => queued.delete(lesson.lessonKey));
    },
    /** The work queued so far, done (tests wait for it). */
    idle: () => queue,
  };
}
export type PracticePrep = ReturnType<typeof createPracticePrep>;
