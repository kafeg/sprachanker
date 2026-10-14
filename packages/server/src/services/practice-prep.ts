// The lesson's AI practice ready ahead: as a lesson starts, each step whose place is on — Reading,
// Listening, Writing, Speaking — takes its next variant of the course's practice the learner has not
// had (no model needed); where none is left, one is made in the background first (owner,
// 2026-10-12/14: a setting, `llm.preparePractice`, on by default; a model set up) — one lesson after
// another for the profile, while the learner does the course's exercises. A step whose latest work is
// still untouched is left as it is. Failures are only logged: the step makes its work on demand.
import { type Lang, parseEditionId } from "@sprachanker/schema";
import type { LessonStart } from "./lessons.ts";
import type { Llm } from "./llm.ts";
import type { Settings } from "./settings.ts";
import type { Talk } from "./talk.ts";
import type { Understanding } from "./understanding.ts";
import type { Writing } from "./writing.ts";

export function createPracticePrep(deps: {
  understanding: Understanding;
  writing: Writing;
  talk: Talk;
  settings: Settings;
  llm: Llm;
}) {
  const { understanding, writing, talk, settings, llm } = deps;
  /** The profile's queue: one lesson's work after another's. */
  let queue: Promise<void> = Promise.resolve();
  /** Lessons queued and not yet done, so a lesson opened twice is made ahead once. */
  const queued = new Set<string>();

  async function prepare(lesson: LessonStart) {
    const off = settings.value("llm.offIn");
    const makeIfNone = !!settings.value("llm.preparePractice") && !!llm.state().model;
    const language: Lang = settings.value("uiLanguage") ?? parseEditionId(lesson.edition).source;
    const request = { ...lesson, language };
    if (!off.includes("understanding")) {
      await understanding.prepare({ ...request, step: "reading" }, makeIfNone);
      await understanding.prepare({ ...request, step: "listening" }, makeIfNone);
    }
    if (!off.includes("writing")) await writing.prepare(request, makeIfNone);
    if (!off.includes("scene")) await talk.prepare(request, makeIfNone);
  }

  return {
    /** A lesson started: its practice queued to be made ahead, when it is to be. */
    lessonStarted(lesson: LessonStart) {
      if (queued.has(lesson.lessonKey)) return;
      queued.add(lesson.lessonKey);
      queue = queue
        .then(() => prepare(lesson))
        .catch((error: unknown) => {
          console.warn(`practice made ahead: ${(error as Error).message}`);
        })
        .finally(() => queued.delete(lesson.lessonKey));
    },
    /** The work queued so far, done (tests wait for it). */
    idle: () => queue,
  };
}
export type PracticePrep = ReturnType<typeof createPracticePrep>;
