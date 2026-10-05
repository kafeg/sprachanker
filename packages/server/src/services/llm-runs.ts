// Runs of the LLM features (05): `chat` (tutor), `scene` and `practice` runs of a lesson, their
// `llm_turn` and `llm_verdict` events. One place for how they are created, read and closed.
import { type LessonKey, LlmTurnPayload, parseLessonKey } from "@sprachanker/schema";
import { and, asc, desc, eq } from "drizzle-orm";
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

    turns(runId: string): LlmTurnPayload[] {
      return db
        .select()
        .from(events)
        .where(and(eq(events.runId, runId), eq(events.type, "llm_turn")))
        .orderBy(asc(events.ts), asc(events.id))
        .all()
        .map((e) => LlmTurnPayload.parse(JSON.parse(e.payloadJson)));
    },

    /** Appends events in one transaction; returns the time of the last one. */
    add(runId: string, type: "llm_turn" | "llm_verdict", payloads: unknown[]): number {
      let ts = now();
      db.transaction((tx) => {
        for (const payload of payloads) {
          ts = now();
          tx.insert(events)
            .values({ id: id(ts), runId, ts, type, payloadJson: JSON.stringify(payload) })
            .run();
        }
      });
      return ts;
    },
  };
  return self;
}
export type LlmRuns = ReturnType<typeof createLlmRuns>;
