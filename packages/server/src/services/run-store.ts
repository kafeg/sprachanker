// Runs and their events (05): the one module that writes and reads the `runs` and `events` tables. A
// run is started, ended once (only while active), and deleted only with its events on the learner's
// confirmed request. Event payloads are checked against their schema when written (schema
// `EVENT_PAYLOADS`) and parsed when read; a stored row that no longer parses is left out and logged,
// never breaking the list it is in. Services keep their own rules; how runs and events are stored
// lives here.
import {
  type CourseKey,
  EVENT_PAYLOADS,
  type EventPayload,
  type EventType,
  type LessonKey,
  type LessonResult,
  parseLessonKey,
  type RunKind,
  type StoredEvent,
} from "@sprachanker/schema";
import { and, asc, desc, eq, gte, inArray, isNull, max, type SQL } from "drizzle-orm";
import { monotonicFactory } from "ulid";
import type { z } from "zod";
import type { ProfileDb } from "../db/profile/db.ts";
import { events, runs } from "../db/profile/schema.ts";
import { ServiceError } from "../errors.ts";

export type RunRow = typeof runs.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type Kind = z.infer<typeof RunKind>;
/** What a run is about: a lesson (lesson, chat, scene, practice runs) or nothing (the day's review). */
export type Context = LessonKey | null;

/** An event to store: its own id when the client named it (idempotency key), else one is made. */
export interface NewEvent<T extends EventType = EventType> {
  id?: string;
  type: T;
  itemKey?: string | null;
  cardId?: string | null;
  payload: EventPayload<T>;
}

/** A stored event read back: its payload parsed with its type's schema. */
export type ReadEvent = StoredEvent;

export function createRunStore(deps: { db: ProfileDb; now: () => number; appVersion: string }) {
  const { db, now } = deps;
  // Monotonic: runs and events made in the same millisecond keep their order.
  const id = monotonicFactory();
  const context = (key: Context) =>
    key === null ? isNull(runs.contextKey) : eq(runs.contextKey, key);

  const toEvent = (row: EventRow): ReadEvent | undefined => {
    const schema = EVENT_PAYLOADS[row.type as EventType];
    const parsed = schema?.safeParse(JSON.parse(row.payloadJson));
    if (!parsed?.success) {
      console.error(`event ${row.id} (${row.type}) does not read as stored; left out`);
      return undefined;
    }
    return {
      id: row.id,
      runId: row.runId,
      ts: row.ts,
      type: row.type as EventType,
      itemKey: row.itemKey,
      cardId: row.cardId,
      payload: parsed.data,
    };
  };
  const read = (rows: EventRow[]) => rows.flatMap((r) => toEvent(r) ?? []);

  /** The row an event is stored as; its payload checked against its type's schema. */
  const row = (runId: string, e: NewEvent, ts: number) => ({
    id: e.id ?? id(ts),
    runId,
    ts,
    type: e.type,
    itemKey: e.itemKey ?? null,
    cardId: e.cardId ?? null,
    payloadJson: JSON.stringify(EVENT_PAYLOADS[e.type].parse(e.payload)),
  });

  const self = {
    /** Runs `fn` in one transaction: what it writes through the store is stored all or nothing. */
    atomic<T>(fn: () => T): T {
      return db.transaction(() => fn());
    },

    /** Starts a run. */
    start(kind: Kind, about: Context, options: { edition?: string | null; plan?: unknown } = {}) {
      return db
        .insert(runs)
        .values({
          id: id(now()),
          kind,
          contextKey: about,
          courseKey: about ? parseLessonKey(about).course : null,
          edition: options.edition ?? null,
          appVersion: deps.appVersion,
          planJson: options.plan === undefined ? null : JSON.stringify(options.plan),
          status: "active",
          startedAt: now(),
        })
        .returning()
        .get();
    },

    /**
     * Ends a run that is still active: finished (with its result) or abandoned. Returns the ended
     * run, or undefined when it had ended already (a run started over meanwhile stays as it is).
     */
    end(
      runId: string,
      status: "finished" | "abandoned",
      reason: "completed" | "user" | "timeout" | "content_updated",
      result?: LessonResult,
    ): RunRow | undefined {
      return db
        .update(runs)
        .set({
          status,
          endReason: reason,
          finishedAt: now(),
          ...(result ? { resultJson: JSON.stringify(result) } : {}),
        })
        .where(and(eq(runs.id, runId), eq(runs.status, "active")))
        .returning()
        .get();
    },

    /** A run by id, if it is of this kind (and about this context, when given). */
    get(runId: string, kind?: Kind, about?: Context) {
      return db
        .select()
        .from(runs)
        .where(
          and(
            eq(runs.id, runId),
            kind ? eq(runs.kind, kind) : undefined,
            about === undefined ? undefined : context(about),
          ),
        )
        .get();
    },

    /** Runs of this kind about a context, newest first. */
    list(kind: Kind, about: Context) {
      return db
        .select()
        .from(runs)
        .where(and(eq(runs.kind, kind), context(about)))
        .orderBy(desc(runs.startedAt), desc(runs.id))
        .all();
    },

    /** Every run of a kind (all lessons), oldest first. */
    all(kind: Kind) {
      return db
        .select()
        .from(runs)
        .where(eq(runs.kind, kind))
        .orderBy(asc(runs.startedAt), asc(runs.id))
        .all();
    },

    /** Ids of every run, of any kind, about a lesson or in a course (resetting progress). */
    idsOf(scope: { lesson: LessonKey } | { course: CourseKey }) {
      return db
        .select({ id: runs.id })
        .from(runs)
        .where(
          "lesson" in scope ? eq(runs.contextKey, scope.lesson) : eq(runs.courseKey, scope.course),
        )
        .all()
        .map((r) => r.id);
    },

    /** The latest run of this kind about a context, any status. */
    latest(kind: Kind, about: Context) {
      return self.list(kind, about)[0];
    },

    /** The active run of this kind about a context (a context has at most one). */
    active(kind: Kind, about: Context) {
      return db
        .select()
        .from(runs)
        .where(and(eq(runs.kind, kind), context(about), eq(runs.status, "active")))
        .orderBy(desc(runs.startedAt), desc(runs.id))
        .get();
    },

    /** The active run of this kind about a lesson, started if there is none. */
    activeOrStart(kind: Kind, lessonKey: LessonKey, edition: string) {
      return self.active(kind, lessonKey) ?? self.start(kind, lessonKey, { edition });
    },

    /**
     * Stores events of a run in one transaction: checked first, all or nothing; only while the run is
     * active (`anyStatus`: also an ended one — an explanation kept with a finished lesson run). An
     * event whose id is stored already is left as it is (sent again) and passed to `onStored`.
     * Returns the time of the last.
     */
    append(
      runId: string,
      list: NewEvent[],
      options: { anyStatus?: boolean; onStored?: (before: ReadEvent) => void } = {},
    ): number {
      const rows = list.map((e) => row(runId, e, now()));
      const ts = rows.at(-1)?.ts ?? now();
      db.transaction((tx) => {
        const run = tx.select({ status: runs.status }).from(runs).where(eq(runs.id, runId)).get();
        if (!run) throw new ServiceError("no_such_run", 404);
        if (!options.anyStatus && run.status !== "active")
          throw new ServiceError("run is not active", 409);
        const named = rows.map((r) => r.id);
        const before = new Map(
          tx
            .select()
            .from(events)
            .where(inArray(events.id, named))
            .all()
            .map((e) => [e.id, e]),
        );
        for (const r of rows) {
          const stored = before.get(r.id);
          if (stored) {
            if (stored.runId !== runId) throw new Error(`event ${r.id} belongs to another run`);
            const read = toEvent(stored);
            if (read) options.onStored?.(read);
            continue;
          }
          tx.insert(events).values(r).run();
        }
      });
      return ts;
    },

    /** One event by id. */
    event(eventId: string): ReadEvent | undefined {
      const row = db.select().from(events).where(eq(events.id, eventId)).get();
      return row && toEvent(row);
    },

    /** A run's events in the order they were stored; of some types only, when given. */
    events(runId: string, types?: EventType[]) {
      return read(
        db
          .select()
          .from(events)
          .where(and(eq(events.runId, runId), types ? inArray(events.type, types) : undefined))
          .orderBy(asc(events.ts), asc(events.id))
          .all(),
      );
    },

    /** The payloads of a run's events of one type, in order, each with the time it was stored. */
    payloads<T extends EventType>(runId: string, type: T): Array<EventPayload<T> & { ts: number }> {
      return self
        .events(runId, [type])
        .map((e) => ({ ...(e.payload as EventPayload<T>), ts: e.ts }));
    },

    /**
     * Events of some types across runs, newest first: since a time, in runs of a kind about a
     * context (the day's card answers, a lesson's verdicts).
     */
    eventsWhere(filter: {
      types: EventType[];
      since?: number;
      kind?: Kind;
      about?: Context;
      runIds?: string[];
    }) {
      const where: Array<SQL | undefined> = [
        inArray(events.type, filter.types),
        filter.since === undefined ? undefined : gte(events.ts, filter.since),
        filter.runIds ? inArray(events.runId, filter.runIds) : undefined,
      ];
      if (filter.kind || filter.about !== undefined)
        where.push(
          inArray(
            events.runId,
            db
              .select({ id: runs.id })
              .from(runs)
              .where(
                and(
                  filter.kind ? eq(runs.kind, filter.kind) : undefined,
                  filter.about === undefined ? undefined : context(filter.about),
                ),
              ),
          ),
        );
      return read(
        db
          .select()
          .from(events)
          .where(and(...where))
          .orderBy(desc(events.ts), desc(events.id))
          .all(),
      );
    },

    /** When each run last had an event of these types (runs without one are absent). */
    lastActivity(types: EventType[]): Map<string, number> {
      return new Map(
        db
          .select({ runId: events.runId, at: max(events.ts) })
          .from(events)
          .where(inArray(events.type, types))
          .groupBy(events.runId)
          .all()
          .map((e) => [e.runId, e.at ?? 0]),
      );
    },

    /**
     * Deletes runs with their events, on the learner's confirmed request: resetting progress, deleting
     * a tutor chat. The only deletion of events besides removing a profile (05).
     */
    remove(runIds: string[]) {
      if (!runIds.length) return { runs: 0, events: 0 };
      return db.transaction((tx) => {
        const removed = tx
          .delete(events)
          .where(inArray(events.runId, runIds))
          .returning({ id: events.id })
          .all();
        tx.delete(runs).where(inArray(runs.id, runIds)).run();
        return { runs: runIds.length, events: removed.length };
      });
    },
  };
  return self;
}
export type RunStore = ReturnType<typeof createRunStore>;
