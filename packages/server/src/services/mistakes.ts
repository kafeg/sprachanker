// The learner's mistakes, derived from lesson runs by the engine (05, "Derived state"): items whose
// first attempt in the latest run that answered them was wrong or partly right, newest first.
import { type Mistake, mistakesOf } from "@sprachanker/engine";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { ProfileDb } from "../db/profile/db.ts";
import { events, runs } from "../db/profile/schema.ts";
import { runEvents } from "./runs.ts";

export type { Mistake } from "@sprachanker/engine";

export function createMistakes(db: ProfileDb) {
  return {
    /** Mistakes in lessons, newest first: of all lessons or of one. */
    list(filter: { lesson?: string; limit?: number } = {}): Mistake[] {
      const lessonRuns = db
        .select({ id: runs.id })
        .from(runs)
        .where(
          and(
            eq(runs.kind, "lesson"),
            filter.lesson ? eq(runs.contextKey, filter.lesson) : undefined,
            inArray(
              runs.id,
              db
                .selectDistinct({ id: events.runId })
                .from(events)
                .where(eq(events.type, "answered")),
            ),
          ),
        )
        .orderBy(asc(runs.startedAt), asc(runs.id))
        .all();
      const all = mistakesOf(lessonRuns.map((r) => ({ events: runEvents(db, r.id) })));
      return all.slice(0, filter.limit ?? all.length);
    },
  };
}
export type Mistakes = ReturnType<typeof createMistakes>;
