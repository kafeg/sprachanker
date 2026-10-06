// Lesson runs: start or resume, append events (outcomes computed here, never trusted from the client),
// finish with the lesson score (04, 05).
import { checkItem, lessonProgress, lessonResult, resumePage } from "@sprachanker/engine";
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
import { and, asc, eq, inArray } from "drizzle-orm";
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

export interface RunsOptions {
  db: ProfileDb;
  content: Content;
  now: () => number;
  appVersion: string;
}

export function createRuns({ db, content, now, appVersion }: RunsOptions) {
  const runEvents = (runId: string) =>
    db
      .select()
      .from(events)
      .where(eq(events.runId, runId))
      .orderBy(asc(events.ts), asc(events.id))
      .all()
      .map(toEvent);
  const getRun = (id: string) => {
    const row = db.select().from(runs).where(eq(runs.id, id)).get();
    if (!row) throw new RunError(`no run ${id}`, 404);
    return row;
  };
  const seriesOf = (row: RunRow) => (row.courseKey ?? "").split("/")[0] ?? "";

  return {
    /** Lesson progress of every lesson with runs. */
    progress() {
      return Object.fromEntries(lessonProgress(db.select().from(runs).all().map(toRun)));
    },

    /** The active run of the lesson, or a new one. */
    start(series: string, lessonKey: LessonKey, edition: string) {
      const active = db
        .select()
        .from(runs)
        .where(
          and(eq(runs.kind, "lesson"), eq(runs.contextKey, lessonKey), eq(runs.status, "active")),
        )
        .get();
      // A run belongs to one edition; switching editions ends the old one (it stays readable).
      if (active && active.edition !== edition) {
        db.update(runs)
          .set({ status: "abandoned", endReason: "user", finishedAt: now() })
          .where(eq(runs.id, active.id))
          .run();
      }
      const current = active && active.edition === edition ? active : undefined;
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
      const list = runEvents(row.id);
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
      const target = row.edition ? parseEditionId(row.edition).target : "de";
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

    /** Ends the run at the summary; the score is the mean of first attempts. */
    finish(runId: string): Run {
      const row = getRun(runId);
      if (row.status !== "active") return toRun(row);
      const result = lessonResult(runEvents(runId));
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
