// The learner's mistakes, derived from lesson runs by the engine: items whose
// first attempt in the latest run that answered them was wrong or partly right, newest first.
import { type Mistake, mistakesOf } from "@sprachanker/engine";
import type { LessonKey, TypedEvent } from "@sprachanker/schema";
import type { RunRow, RunStore } from "./run-store.ts";

export type { Mistake } from "@sprachanker/engine";

export function createMistakes(
  store: RunStore,
  /** A run's events as read, its answers said aloud judged (the lessons service). */
  judged: (row: RunRow, events: TypedEvent[]) => Promise<TypedEvent[]>,
) {
  return {
    /** Mistakes in lessons, newest first: of all lessons, of one, or of a few (`lessons`: only their
     *  runs are read). */
    async list(
      filter: { lesson?: LessonKey; lessons?: LessonKey[]; limit?: number } = {},
    ): Promise<Mistake[]> {
      const some = filter.lessons ?? (filter.lesson && [filter.lesson]);
      // Lesson runs, oldest first (each lesson's: their order across lessons does not matter).
      const runs = some
        ? some.flatMap((key) => store.list("lesson", key).reverse())
        : store.all("lesson");
      // Of all lessons, only the runs with an answer are read.
      const answered = some ? undefined : new Set(store.lastActivity(["answered"]).keys());
      const lessonRuns = answered ? runs.filter((r) => answered.has(r.id)) : runs;
      const answers = store.eventsOf(
        lessonRuns.map((r) => r.id),
        ["answered"],
      );
      const all = mistakesOf(
        await Promise.all(
          lessonRuns.map(async (r) => ({ events: await judged(r, answers.get(r.id) ?? []) })),
        ),
      );
      return all.slice(0, filter.limit ?? all.length);
    },
  };
}
export type Mistakes = ReturnType<typeof createMistakes>;
