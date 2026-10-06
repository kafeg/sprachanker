// Runs of the LLM features (05): `chat` (tutor), `scene` and `practice` runs of a lesson, their
// `llm_turn` and `llm_verdict` events (and the `llm_verdict` explanations stored in lesson runs). One
// place for how they are created, read, closed and deleted.
import { type LessonKey, LlmTurnPayload, parseLessonKey } from "@sprachanker/schema";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { monotonicFactory } from "ulid";
import type { ProfileDb } from "../db/profile/db.ts";
import { events, runs } from "../db/profile/schema.ts";

export type LlmRunKind = "chat" | "scene" | "practice";

export function createLlmRuns(deps: { db: ProfileDb; now: () => number; appVersion: string }) {
  const { db, now } = deps;
  // Monotonic: events written in the same millisecond keep their order.
  const id = monotonicFactory();

  const self = {
    /** The latest run of this kind for the lesson, any status. */
    latest(kind: LlmRunKind, lessonKey: string) {
      return db
        .select()
        .from(runs)
        .where(and(eq(runs.kind, kind), eq(runs.contextKey, lessonKey)))
        .orderBy(desc(runs.startedAt), desc(runs.id))
        .get();
    },

    active(kind: LlmRunKind, lessonKey: string) {
      const run = self.latest(kind, lessonKey);
      return run?.status === "active" ? run : undefined;
    },

    start(kind: LlmRunKind, lessonKey: LessonKey, edition: string, plan?: unknown) {
      return db
        .insert(runs)
        .values({
          id: id(now()),
          kind,
          contextKey: lessonKey,
          courseKey: parseLessonKey(lessonKey).course,
          edition,
          appVersion: deps.appVersion,
          planJson: plan === undefined ? null : JSON.stringify(plan),
          status: "active",
          startedAt: now(),
        })
        .returning()
        .get();
    },

    /** The active run of this kind for the lesson, started if there is none. */
    activeOrStart(kind: LlmRunKind, lessonKey: LessonKey, edition: string) {
      return self.active(kind, lessonKey) ?? self.start(kind, lessonKey, edition);
    },

    finish(runId: string, endReason: "completed" | "user") {
      db.update(runs)
        .set({ status: "finished", endReason, finishedAt: now() })
        .where(eq(runs.id, runId))
        .run();
    },

    /** Runs of this kind for the lesson, newest first. */
    list(kind: LlmRunKind, lessonKey: string) {
      return db
        .select()
        .from(runs)
        .where(and(eq(runs.kind, kind), eq(runs.contextKey, lessonKey)))
        .orderBy(desc(runs.startedAt), desc(runs.id))
        .all();
    },

    /** One run, if it is of this kind and about this lesson. */
    get(kind: LlmRunKind, lessonKey: string, runId: string) {
      return db
        .select()
        .from(runs)
        .where(and(eq(runs.id, runId), eq(runs.kind, kind), eq(runs.contextKey, lessonKey)))
        .get();
    },

    /** A run's turns in order, each with the time it was stored. */
    turns(runId: string): Array<LlmTurnPayload & { ts: number }> {
      return db
        .select()
        .from(events)
        .where(and(eq(events.runId, runId), eq(events.type, "llm_turn")))
        .orderBy(asc(events.ts), asc(events.id))
        .all()
        .map((e) => ({ ...LlmTurnPayload.parse(JSON.parse(e.payloadJson)), ts: e.ts }));
    },

    /** Appends events in one transaction (on an item, for explanations); returns the time of the
     *  last one. */
    add(
      runId: string,
      type: "llm_turn" | "llm_verdict",
      payloads: unknown[],
      itemKey?: string,
    ): number {
      let ts = now();
      db.transaction((tx) => {
        for (const payload of payloads) {
          ts = now();
          tx.insert(events)
            .values({
              id: id(ts),
              runId,
              ts,
              type,
              itemKey: itemKey ?? null,
              payloadJson: JSON.stringify(payload),
            })
            .run();
        }
      });
      return ts;
    },

    /**
     * Deletes runs with their events, on the learner's confirmed request (a tutor chat); like resetting
     * progress, an exception to append-only events (05).
     */
    remove(runIds: string[]) {
      if (!runIds.length) return;
      db.transaction((tx) => {
        tx.delete(events).where(inArray(events.runId, runIds)).run();
        tx.delete(runs).where(inArray(runs.id, runIds)).run();
      });
    },
  };
  return self;
}
export type LlmRuns = ReturnType<typeof createLlmRuns>;
