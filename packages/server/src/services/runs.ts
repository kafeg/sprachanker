// Lesson runs: start or resume, append events (outcomes computed here, never trusted from the client),
// finish with the lesson score (04, 05).
import {
  checkItem,
  exerciseResults,
  type LessonProgress,
  lessonCoverage,
  lessonDone,
  lessonProgress,
  lessonResult,
  resumePage,
} from "@sprachanker/engine";
import {
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
} from "@sprachanker/schema";
import { and, asc, desc, eq, inArray, max } from "drizzle-orm";
import { ulid } from "ulid";
import type { ProfileDb } from "../db/profile/db.ts";
import { events, runs } from "../db/profile/schema.ts";
import type { Content } from "./content.ts";

export class RunError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

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

/** Lessons done in a course and the lesson to go on with: the one worked on most recently, else the
 *  first not done yet. */
export function courseProgress(lessons: string[], progress: Record<string, LessonProgress>) {
  const active = lessons
    .filter((k) => progress[k]?.activeAt !== undefined)
    .sort((a, b) => (progress[b]?.activeAt ?? 0) - (progress[a]?.activeAt ?? 0))[0];
  const next = active ?? lessons.find((k) => !lessonDone(progress[k])) ?? lessons[0];
  return {
    done: lessons.filter((k) => lessonDone(progress[k])).length,
    next: next ?? null,
    nextStarted: !!active,
  };
}

export function createRuns({ db, content, now, appVersion }: RunsOptions) {
  const getRun = (id: string) => {
    const row = db.select().from(runs).where(eq(runs.id, id)).get();
    if (!row) throw new RunError(`no run ${id}`, 404);
    return row;
  };
  const seriesOf = (row: RunRow) => (row.courseKey ?? "").split("/")[0] ?? "";

  /**
   * A finished run counts as completed only when every exercise of the lesson was answered or skipped
   * in it. Runs finished before that was enforced (by merely opening the summary) are no completions:
   * they are not shown and not counted. Finished runs never change, so the answer is kept.
   */
  const complete = new Map<string, boolean>();
  const completed = async (row: RunRow) => {
    if (row.status !== "finished") return false;
    if (!complete.has(row.id)) {
      const lesson = await content.lesson(seriesOf(row), row.contextKey as LessonKey);
      complete.set(row.id, lessonCoverage(lesson, exerciseResults(runEvents(db, row.id))).complete);
    }
    return complete.get(row.id) as boolean;
  };

  /**
   * The run a lesson shows — in the player, on the course map and in the session review: its active
   * run (in `edition`, when given), else its latest completed run.
   */
  const shownRun = async (lessonKey: string, edition?: string) => {
    const lessonRuns = db
      .select()
      .from(runs)
      .where(and(eq(runs.kind, "lesson"), eq(runs.contextKey, lessonKey)))
      .orderBy(desc(runs.startedAt), desc(runs.id))
      .all();
    const active = lessonRuns.find(
      (r) => r.status === "active" && (!edition || r.edition === edition),
    );
    if (active) return active;
    for (const r of lessonRuns) if (await completed(r)) return r;
    return undefined;
  };

  /** Lesson progress of every lesson with runs, over active and completed runs. An active run counts
   *  as "in progress" only once something was answered or skipped in it. */
  const progress = async () => {
    const activity = new Map(
      db
        .select({ runId: events.runId, at: max(events.ts) })
        .from(events)
        .where(inArray(events.type, ["answered", "item_skipped"]))
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

    /** Events of the run the lesson shows (for the session review). */
    async shownEvents(lessonKey: string) {
      const row = await shownRun(lessonKey);
      return row ? runEvents(db, row.id) : [];
    },

    /** Each lesson's state for the course map, read like the player reads it. */
    async lessonStates(
      series: string,
      lessons: LessonKey[],
      edition: string,
    ): Promise<Record<string, LessonState>> {
      const byLesson = await progress();
      const out: Record<string, LessonState> = {};
      for (const key of lessons) {
        const row = await shownRun(key, edition);
        if (!row) continue;
        const lesson = await content.lesson(series, key);
        const coverage = lessonCoverage(lesson, exerciseResults(runEvents(db, row.id)));
        const result = toRun(row).result;
        out[key] = {
          done: lessonDone(byLesson[key]),
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
     * What the lesson shows on opening, without starting anything: its active run in this edition, else
     * its latest completed run (read-only), else null.
     */
    async lessonState(series: string, lessonKey: LessonKey, edition: string) {
      const row = await shownRun(lessonKey, edition);
      if (!row?.courseKey?.startsWith(`${series}/`)) return null;
      const list = runEvents(db, row.id);
      return { run: toRun(row), events: list, resumePage: resumePage(list) };
    },

    /** The active run of the lesson, or a new one; `restart` ends the active one first. */
    start(series: string, lessonKey: LessonKey, edition: string, restart = false) {
      const active = db
        .select()
        .from(runs)
        .where(
          and(eq(runs.kind, "lesson"), eq(runs.contextKey, lessonKey), eq(runs.status, "active")),
        )
        .get();
      // A run belongs to one edition; switching editions (or starting over) ends the old one; it
      // stays readable.
      if (active && (restart || active.edition !== edition)) {
        db.update(runs)
          .set({ status: "abandoned", endReason: "user", finishedAt: now() })
          .where(eq(runs.id, active.id))
          .run();
      }
      const current = active && !restart && active.edition === edition ? active : undefined;
      const row =
        current ??
        db
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
      if (!row.courseKey?.startsWith(`${series}/`))
        throw new RunError("lesson is not in this series");
      const list = runEvents(db, row.id);
      return { run: toRun(row), events: list, resumePage: resumePage(list) };
    },

    /** Appends events idempotently (by id); returns the outcome of each `answered` event. */
    async append(runId: string, input: unknown[]): Promise<Record<string, Outcome>> {
      const row = getRun(runId);
      if (row.status !== "active") throw new RunError("run is not active", 409);
      const parsed = input.map((e) => EventInput.parse(e));
      const known = new Set(
        parsed.length
          ? db
              .select({ id: events.id })
              .from(events)
              .where(
                inArray(
                  events.id,
                  parsed.map((e) => e.id),
                ),
              )
              .all()
              .map((e) => e.id)
          : [],
      );
      const series = seriesOf(row);
      const lesson = await content.lesson(series, row.contextKey as LessonKey);
      const locale = row.edition
        ? await content.localeLesson(series, lesson.key, row.edition)
        : undefined;
      // Answers are checked in the language the edition teaches (case rules differ, 04).
      if (!row.edition) throw new RunError("lesson run without an edition");
      const target = parseEditionId(row.edition).target;
      const outcomes: Record<string, Outcome> = {};
      for (const e of parsed) {
        if (known.has(e.id)) continue;
        let payload: unknown = e.payload;
        if (e.type === "answered") {
          const { exercise: exKey, n } = parseItemKey(e.itemKey as ItemKey);
          const exercise = findExercise(lesson, exKey);
          if (!exercise) throw new RunError(`item ${e.itemKey} is not in ${lesson.key}`);
          const outcome = checkItem(exercise, n - 1, e.payload.answer, target);
          outcomes[e.id] = outcome;
          payload = { ...e.payload, outcome };
        } else if (e.type === "item_skipped") {
          const { exercise: exKey } = parseItemKey(e.itemKey as ItemKey);
          if (!findExercise(lesson, exKey))
            throw new RunError(`item ${e.itemKey} is not in ${lesson.key}`);
          payload = {};
        } else {
          const exercise = lesson.pages[e.payload.pageIndex]?.exercise;
          if (exercise) {
            payload = {
              ...e.payload,
              snapshot: { exercise, locale: locale?.exercises[exercise.key] ?? null },
            };
          }
        }
        db.insert(events)
          .values({
            id: e.id,
            runId,
            ts: now(),
            type: e.type,
            itemKey: e.itemKey ?? null,
            payloadJson: JSON.stringify(payload),
          })
          .run();
      }
      return outcomes;
    },

    /** Completes the run once every exercise of the lesson was answered or skipped; the score is the
     *  mean of first attempts. A run with exercises left is refused (409 `run_incomplete`). */
    async finish(runId: string): Promise<Run> {
      const row = getRun(runId);
      if (row.status !== "active") return toRun(row);
      const list = runEvents(db, runId);
      const lesson = await content.lesson(seriesOf(row), row.contextKey as LessonKey);
      if (!lessonCoverage(lesson, exerciseResults(list)).complete)
        throw new RunError("run_incomplete", 409);
      const result = lessonResult(lesson, list);
      return toRun(
        db
          .update(runs)
          .set({
            status: "finished",
            endReason: "completed",
            finishedAt: now(),
            resultJson: JSON.stringify(result),
          })
          .where(eq(runs.id, runId))
          .returning()
          .get(),
      );
    },
  };
}
export type Runs = ReturnType<typeof createRuns>;
