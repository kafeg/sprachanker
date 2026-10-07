// The learner's mistakes, derived from lesson runs by the engine (05, "Derived state"): items whose
// first attempt in the latest run that answered them was wrong or partly right, newest first.
import { type Mistake, mistakesOf } from "@sprachanker/engine";
import type { LessonKey } from "@sprachanker/schema";
import type { RunStore } from "./run-store.ts";

export type { Mistake } from "@sprachanker/engine";

export function createMistakes(store: RunStore) {
  return {
    /** Mistakes in lessons, newest first: of all lessons or of one. */
    list(filter: { lesson?: LessonKey; limit?: number } = {}): Mistake[] {
      // Lesson runs with an answer, oldest first.
      const answered = new Set(store.lastActivity(["answered"]).keys());
      const lessonRuns = (
        filter.lesson ? store.list("lesson", filter.lesson).reverse() : store.all("lesson")
      ).filter((r) => answered.has(r.id));
      const answers = store.eventsOf(
        lessonRuns.map((r) => r.id),
        ["answered"],
      );
      const all = mistakesOf(lessonRuns.map((r) => ({ events: answers.get(r.id) ?? [] })));
      return all.slice(0, filter.limit ?? all.length);
    },
  };
}
export type Mistakes = ReturnType<typeof createMistakes>;
