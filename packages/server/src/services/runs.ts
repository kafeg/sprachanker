// Lesson runs: start or resume, append events (outcomes computed here, never trusted from the client),
// finish with the lesson score (04, 05).
import {
  checkItem,
  exerciseResults,
  lessonCoverage,
  lessonDone,
  lessonProgress,
  lessonResult,
  lessonSteps,
  planCoverage,
  resumePage,
  stepsDone,
} from "@sprachanker/engine";
import {
  type CourseKey,
  EventInput,
  findExercise,
  type ItemKey,
  type LessonKey,
  LessonResult,
  type Outcome,
  parseEditionId,
  parseItemKey,
  parseLessonKey,
  type Run,
  type StoredEvent,
  seriesOf,
} from "@sprachanker/schema";
import { and, asc, count, desc, eq, inArray, max } from "drizzle-orm";
import { ulid } from "ulid";
import type { ProfileDb } from "../db/profile/db.ts";
import { events, runs } from "../db/profile/schema.ts";
import { ServiceError } from "../errors.ts";
import type { Content } from "./content.ts";

type RunRow = typeof runs.$inferSelect;
type EventRow = typeof events.$inferSelect;

const toRun = (r: RunRow): Run => ({
  id: r.id,
  kind: r.kind as Run["kind"],
  contextKey: r.contextKey as LessonKey | null,
  courseKey: r.courseKey,
  edition: r.edition,
  status: r.status as Run["status"],
  endReason: r.endReason as Run["endReason"],
  startedAt: r.startedAt,
  finishedAt: r.finishedAt,
  result: r.resultJson ? LessonResult.parse(JSON.parse(r.resultJson)) : null,
});
const toEvent = (e: EventRow): StoredEvent => ({
  id: e.id,
  runId: e.runId,
  ts: e.ts,
  type: e.type as StoredEvent["type"],
  itemKey: e.itemKey,
  payload: JSON.parse(e.payloadJson),
});

/** Events of a run in the order they were stored. */
export const runEvents = (db: ProfileDb, runId: string) =>
  db
    .select()
    .from(events)
    .where(eq(events.runId, runId))
    .orderBy(asc(events.ts), asc(events.id))
    .all()
    .map(toEvent);

/** A lesson on the course map: whether it counts as done, and the run it opens as the lesson shows it. */
export interface LessonState {
  done: boolean;
  run?: {
    status: "active" | "finished";
    /** Exercises answered or skipped, of all the lesson's exercises. */
    worked: number;
    total: number;
    /** Score of a finished run that scored any item. */
    score?: number;
  };
}

export interface RunsOptions {
  db: ProfileDb;
  content: Content;
  now: () => number;
  appVersion: string;
}

export function createRuns({ db, content, now, appVersion }: RunsOptions) {
  /** A lesson run by id (the lesson endpoints take no other kind). */
  const getRun = (id: string) => {
    const row = db
      .select()
      .from(runs)
      .where(and(eq(runs.id, id), eq(runs.kind, "lesson")))
      .get();
    if (!row) throw new ServiceError("no_such_run", 404);
    return row;
  };
  /** The lesson of a run, or undefined when it is no longer in the library (a course removed). */
  const lessonOf = async (row: RunRow) => {
    const key = row.contextKey as LessonKey;
    return content.lesson(seriesOf(key), key).catch((error: unknown) => {
      console.error(`lesson of run ${row.id}:`, (error as Error).message);
      return undefined;
    });
  };

  /**
   * A finished run counts as completed only when every exercise of the lesson was answered or skipped
   * in it. Runs finished before that was enforced (by merely opening the summary) are no completions:
   * they are not shown and not counted. Finished runs never change, so the answer is kept.
   */
  const complete = new Map<string, boolean>();
  const completed = async (row: RunRow) => {
    if (row.status !== "finished") return false;
    if (!complete.has(row.id)) {
      // A lesson that cannot be read is not counted, and asked again next time.
      const lesson = await lessonOf(row);
      if (!lesson) return false;
      complete.set(row.id, lessonCoverage(lesson, exerciseResults(runEvents(db, row.id))).complete);
    }
    return complete.get(row.id) as boolean;
  };

  /**
   * The run a lesson shows — in the player, on the course map and in the session review: its active
   * run (a lesson has one, in whichever edition it was started), else its latest completed run.
   */
  const shownRun = async (lessonKey: string) => {
    const lessonRuns = db
      .select()
      .from(runs)
      .where(and(eq(runs.kind, "lesson"), eq(runs.contextKey, lessonKey)))
      .orderBy(desc(runs.startedAt), desc(runs.id))
      .all();
    const active = lessonRuns.find((r) => r.status === "active");
    if (active) return active;
    for (const r of lessonRuns) if (await completed(r)) return r;
    return undefined;
  };

  /** Lesson progress of every lesson with runs, over active and completed runs. An active run counts
   *  as "in progress" only once something was answered, skipped or a step done in it. */
  const progress = async () => {
    const activity = new Map(
      db
        .select({ runId: events.runId, at: max(events.ts) })
        .from(events)
        // Work done in the run: an answer, a skip, or a step of the plan (words, a page read, practice).
        .where(inArray(events.type, ["answered", "item_skipped", "step_done"]))
        .groupBy(events.runId)
        .all()
        .map((e) => [e.runId, e.at ?? 0]),
    );
    const counted: Run[] = [];
    for (const row of db.select().from(runs).where(eq(runs.kind, "lesson")).all())
      if (row.status === "active" || (await completed(row))) counted.push(toRun(row));
    return Object.fromEntries(lessonProgress(counted, activity));
  };

  return {
    progress,

    /** One of the lesson's runs, if `runId` is one (explanations are kept in lesson runs). */
    lessonRun(lessonKey: string, runId: string): Run | undefined {
      const row = db
        .select()
        .from(runs)
        .where(and(eq(runs.id, runId), eq(runs.kind, "lesson"), eq(runs.contextKey, lessonKey)))
        .get();
      return row && toRun(row);
    },

    /** The run the lesson shows, with its events (for the session review and the tutor). */
    async shown(lessonKey: string): Promise<{ run: Run; events: StoredEvent[] } | undefined> {
      const row = await shownRun(lessonKey);
      return row && { run: toRun(row), events: runEvents(db, row.id) };
    },

    /** Each lesson's state for the course map, read like the player reads it. `byLesson` is
     *  `progress()` when the caller has it already. */
    async lessonStates(
      lessons: LessonKey[],
      byLesson?: Awaited<ReturnType<typeof progress>>,
    ): Promise<Record<string, LessonState>> {
      const progressOf = byLesson ?? (await progress());
      const out: Record<string, LessonState> = {};
      for (const key of lessons) {
        const row = await shownRun(key);
        if (!row) continue;
        const lesson = await lessonOf(row);
        if (!lesson) continue;
        const coverage = lessonCoverage(lesson, exerciseResults(runEvents(db, row.id)));
        const result = toRun(row).result;
        out[key] = {
          done: lessonDone(progressOf[key]),
          run: {
            status: row.status as "active" | "finished",
            worked: coverage.worked,
            total: coverage.total,
            ...(result?.scored ? { score: result.score } : {}),
          },
        };
      }
      return out;
    },

    /**
     * What the lesson shows on opening, without starting anything: its active run, else
     * its latest completed run (read-only), else null.
     */
    async lessonState(series: string, lessonKey: LessonKey) {
      const row = await shownRun(lessonKey);
      if (!row?.courseKey?.startsWith(`${series}/`)) return null;
      const list = runEvents(db, row.id);
      return { run: toRun(row), events: list, resumePage: resumePage(list) };
    },

    /**
     * Resets the learner's progress in a course, or in one of its lessons: every run of it — lesson
     * runs, tutor chats, writing checks and reviews, scenes — and their events are deleted. The only
     * deletion of events besides removing a profile; the screen asks for confirmation (05).
     */
    reset(course: CourseKey, lesson?: LessonKey): { runs: number; events: number } {
      const ids = db
        .select({ id: runs.id })
        .from(runs)
        .where(lesson ? eq(runs.contextKey, lesson) : eq(runs.courseKey, course))
        .all()
        .map((r) => r.id);
      if (!ids.length) return { runs: 0, events: 0 };
      const counted = db
        .select({ n: count() })
        .from(events)
        .where(inArray(events.runId, ids))
        .get();
      db.transaction((tx) => {
        tx.delete(events).where(inArray(events.runId, ids)).run();
        tx.delete(runs).where(inArray(runs.id, ids)).run();
      });
      return { runs: ids.length, events: counted?.n ?? 0 };
    },

    /** The active run of the lesson, or a new one; `restart` ends the active one first. Everything is
     *  checked before anything is written. */
    async start(series: string, lessonKey: LessonKey, edition: string, restart = false) {
      if (seriesOf(lessonKey) !== series) throw new ServiceError("lesson is not in this series");
      await content.lesson(series, lessonKey);
      const row = db.transaction((tx) => {
        const active = tx
          .select()
          .from(runs)
          .where(
            and(eq(runs.kind, "lesson"), eq(runs.contextKey, lessonKey), eq(runs.status, "active")),
          )
          .get();
        if (active && !restart && active.edition === edition) return active;
        // A run belongs to one edition; switching editions (or starting over) ends the old one; it
        // stays readable.
        if (active)
          tx.update(runs)
            .set({ status: "abandoned", endReason: "user", finishedAt: now() })
            .where(and(eq(runs.id, active.id), eq(runs.status, "active")))
            .run();
        return tx
          .insert(runs)
          .values({
            id: ulid(now()),
            kind: "lesson",
            contextKey: lessonKey,
            courseKey: parseLessonKey(lessonKey).course,
            edition,
            appVersion,
            status: "active",
            startedAt: now(),
          })
          .returning()
          .get();
      });
      const list = runEvents(db, row.id);
      return { run: toRun(row), events: list, resumePage: resumePage(list) };
    },

    /**
     * Appends events idempotently (by id): the batch is checked whole, then written in one transaction,
     * so it is stored entirely or not at all; an id stored before is left as it is. Returns the outcome
     * of each `answered` event of the batch — the stored one for an event sent again.
     */
    async append(runId: string, input: unknown[]): Promise<Record<string, Outcome>> {
      const row = getRun(runId);
      if (row.status !== "active") throw new ServiceError("run is not active", 409);
      const parsed: EventInput[] = [];
      const seen = new Set<string>();
      for (const e of input) {
        const result = EventInput.safeParse(e);
        if (!result.success) throw new ServiceError("invalid_event");
        if (seen.has(result.data.id)) continue;
        seen.add(result.data.id);
        parsed.push(result.data);
      }
      if (!row.edition) throw new ServiceError("lesson run without an edition", 409);
      const series = seriesOf(row.contextKey as LessonKey);
      const lesson = await content.lesson(series, row.contextKey as LessonKey);
      const locale = await content.localeLesson(series, lesson.key, row.edition);
      // Answers are checked in the language the edition teaches (case rules differ, 04).
      const target = parseEditionId(row.edition).target;
      const outcomes: Record<string, Outcome> = {};
      const rows = parsed.map((e) => {
        let payload: unknown = e.payload;
        if (e.type === "answered") {
          const { exercise: exKey, n } = parseItemKey(e.itemKey as ItemKey);
          const exercise = findExercise(lesson, exKey);
          if (!exercise) throw new ServiceError(`item ${e.itemKey} is not in ${lesson.key}`);
          let outcome: Outcome;
          try {
            outcome = checkItem(exercise, n - 1, e.payload.answer, target);
          } catch {
            throw new ServiceError(`answer does not fit ${e.itemKey}`);
          }
          outcomes[e.id] = outcome;
          payload = { ...e.payload, outcome };
        } else if (e.type === "item_skipped") {
          const { exercise: exKey } = parseItemKey(e.itemKey as ItemKey);
          if (!findExercise(lesson, exKey))
            throw new ServiceError(`item ${e.itemKey} is not in ${lesson.key}`);
          payload = {};
        } else if (e.type === "page_shown") {
          const exercise = lesson.pages[e.payload.pageIndex]?.exercise;
          if (exercise) {
            payload = {
              ...e.payload,
              snapshot: { exercise, locale: locale?.exercises[exercise.key] ?? null },
            };
          }
        }
        return {
          id: e.id,
          runId,
          type: e.type,
          itemKey: e.itemKey ?? null,
          payloadJson: JSON.stringify(payload),
        };
      });
      return db.transaction((tx) => {
        // Checked again after the lesson was read: the run may have ended meanwhile.
        const status = tx
          .select({ status: runs.status })
          .from(runs)
          .where(eq(runs.id, runId))
          .get();
        if (status?.status !== "active") throw new ServiceError("run is not active", 409);
        const stored = new Map(
          rows.length
            ? tx
                .select()
                .from(events)
                .where(
                  inArray(
                    events.id,
                    rows.map((r) => r.id),
                  ),
                )
                .all()
                .map((e) => [e.id, e])
            : [],
        );
        for (const r of rows) {
          const before = stored.get(r.id);
          if (before) {
            if (before.runId !== runId)
              throw new ServiceError(`event ${r.id} is another run's`, 409);
            if (before.type === "answered")
              outcomes[r.id] = (JSON.parse(before.payloadJson) as { outcome: Outcome }).outcome;
            else delete outcomes[r.id];
            continue;
          }
          tx.insert(events)
            .values({ ...r, ts: now() })
            .run();
        }
        return outcomes;
      });
    },

    /**
     * Completes the run once every step of the lesson's plan is done or skipped — its exercises answered
     * or skipped, its words, grammar and culture steps recorded (the AI practice, offered only with an
     * assistant, is left to the player) — the score is the mean of first attempts. A run with steps
     * left is refused (409 `run_incomplete`).
     */
    async finish(runId: string): Promise<Run> {
      const row = getRun(runId);
      if (row.status !== "active") return toRun(row);
      const series = seriesOf(row.contextKey as LessonKey);
      const lesson = await content.lesson(series, row.contextKey as LessonKey);
      const locale = row.edition
        ? await content.localeLesson(series, lesson.key, row.edition)
        : undefined;
      const list = runEvents(db, runId);
      const steps = lessonSteps(lesson, locale);
      if (!planCoverage(steps, lesson, exerciseResults(list), stepsDone(list)).complete)
        throw new ServiceError("run_incomplete", 409);
      const result = lessonResult(lesson, list);
      // Only an active run finishes: one started over meanwhile stays abandoned.
      const finished = db
        .update(runs)
        .set({
          status: "finished",
          endReason: "completed",
          finishedAt: now(),
          resultJson: JSON.stringify(result),
        })
        .where(and(eq(runs.id, runId), eq(runs.status, "active")))
        .returning()
        .get();
      return toRun(finished ?? getRun(runId));
    },
  };
}
export type Runs = ReturnType<typeof createRuns>;
