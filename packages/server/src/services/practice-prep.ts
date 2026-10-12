// The lesson's AI practice made ahead (04, "AI practice in courses"; owner, 2026-10-12): as a lesson
// starts, its Reading and Listening texts, its writing task and its speaking one are made in the background — one call
// after another for the profile, while the learner does the course's exercises — so each step has
// its work ready when it comes. Only with a model set up, the setting on (`llm.preparePractice`, on by
// default) and the step's place on; a step whose latest work is still untouched is left as it is.
// Failures are only logged: the step makes its work on demand as before.
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
    const language: Lang = settings.value("uiLanguage") ?? parseEditionId(lesson.edition).source;
    const request = { ...lesson, language };
    if (!off.includes("understanding")) {
      await understanding.prepare({ ...request, step: "reading" });
      await understanding.prepare({ ...request, step: "listening" });
    }
    if (!off.includes("writing")) {
      const state = await writing.state(lesson.series, lesson.lessonKey, lesson.edition);
      const untouched = state.task && !state.attempts.some((a) => a.ts > (state.task?.ts ?? 0));
      if (!untouched && !state.preparing)
        await writing.task(request).catch((error: unknown) => {
          console.warn(`writing task made ahead: ${(error as Error).message}`);
        });
    }
    if (!off.includes("scene")) await talk.prepare(request);
  }

  return {
    /** A lesson started: its practice queued to be made ahead, when it is to be. */
    lessonStarted(lesson: LessonStart) {
      if (!settings.value("llm.preparePractice") || !llm.state().model) return;
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
