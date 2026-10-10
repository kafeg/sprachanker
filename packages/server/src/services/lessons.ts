// Lesson runs: start or resume, append events (outcomes computed here, never trusted from the client),
// finish with the lesson score (04, 05). Storage goes through the run store.
import {
  checkItem,
  courseProgress,
  exerciseResults,
  LESSON_WORK,
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
  EventInput,
  findExercise,
  type ItemKey,
  type LessonKey,
  LessonResult,
  type ModuleStanding,
  type Outcome,
  parseEditionId,
  parseItemKey,
  type Run,
  type RunStatus,
  seriesOf,
  type TypedEvent,
} from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import { appendAnswers } from "./answers.ts";
import { type Content, courseTitle } from "./content.ts";
import { headerOf, type NewEvent, type RunRow, type RunStore, readStored } from "./run-store.ts";

export const toRun = (r: RunRow): Run => ({
  ...headerOf(r),
  kind: r.kind,
  contextKey: r.contextKey as LessonKey | null,
  courseKey: r.courseKey,
  result: readStored(r.resultJson, LessonResult, `result of run ${r.id}`) ?? null,
});

/** A lesson's title in an edition, if the lesson is still installed. */
export const lessonTitle = (content: Content, lessonKey: LessonKey, edition: string | null) =>
  edition
    ? content
        .localeLesson(seriesOf(lessonKey), lessonKey, edition)
        .then((l) => l?.title)
        .catch(() => undefined)
    : Promise.resolve(undefined);

/** A lesson on the course map: whether it counts as done, and the run it opens as the lesson shows it. */
export interface LessonState {
  done: boolean;
  run?: {
    status: Exclude<RunStatus, "abandoned">;
    /** Exercises answered or skipped, of all the lesson's exercises. */
    worked: number;
    total: number;
    /** Score of a finished run that scored any item. */
    score?: number;
  };
}

export function createRuns({ store, content }: { store: RunStore; content: Content }) {
  /** A lesson run by id (the lesson endpoints take no other kind). */
  const getRun = (id: string) => {
    const row = store.get(id, "lesson");
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
   * A finished run is a completion by how it ended: the server ends a run `finished/completed` only
   * when its plan was done then (`finish`, `replace`). A lesson changed since — an exercise added when
   * its course was normalised again — does not take that back.
   */
  const completed = (row: RunRow) => row.status === "finished" && row.endReason === "completed";

  /**
   * The run a lesson shows — in the player, on the course map and to the tutor: its active
   * run (a lesson has one, in whichever edition it was started), else its latest completed run.
   */
  const shownRun = async (lessonKey: LessonKey) => {
    const lessonRuns = store.list("lesson", lessonKey);
    const active = lessonRuns.find((r) => r.status === "active");
    if (active) return active;
    for (const r of lessonRuns) if (completed(r)) return r;
    return undefined;
  };

  /** A run as the player opens it: the run, its events, and the page to go on with (where the last
   *  exercise shown is in the lesson now). */
  const openState = async (row: RunRow) => {
    const list = store.events(row.id);
    const key = row.contextKey as LessonKey;
    const lesson = await content.lesson(seriesOf(key), key).catch(() => undefined);
    return { run: toRun(row), events: list, resumePage: resumePage(list, lesson) };
  };

  /** Lesson progress of every lesson with runs, over active and completed runs. An active run counts
   *  as "in progress" only once something was answered, skipped or a step done in it. */
  const progress = async () => {
    // Work done in the run: an answer, a skip, or a step of the plan (words, a page read, practice).
    const activity = store.lastActivity([...LESSON_WORK]);
    const counted: Run[] = [];
    for (const row of store.all("lesson"))
      if (row.status === "active" || completed(row)) counted.push(toRun(row));
    return Object.fromEntries(lessonProgress(counted, activity));
  };

  /**
   * The lessons' standing (schema `stats.ts`): how many are done, and each lesson worked on (a run
   * with work in it; a lesson only opened is none) under its course — its passes, its best score, a
   * pass open, its last work. Courses by their last work; a course's lessons in its order (its index:
   * a key kept through a reorder says nothing of where the lesson is now), one no longer in it last.
   */
  async function standing(): Promise<ModuleStanding> {
    const byLesson = await progress();
    const worked = store.lastActivity([...LESSON_WORK]);
    const runsOf = new Map<LessonKey, RunRow[]>();
    for (const row of store.all("lesson")) {
      if (!worked.has(row.id)) continue;
      const key = row.contextKey as LessonKey;
      runsOf.set(key, [...(runsOf.get(key) ?? []), row]);
    }
    const installed = await content.courses();
    const lessons = await Promise.all(
      [...runsOf].map(async ([key, rows]) => {
        const latest = rows.at(-1) as RunRow;
        const p = byLesson[key];
        return {
          course: latest.courseKey as string,
          edition: latest.edition,
          entry: {
            key,
            title: (await lessonTitle(content, key, latest.edition)) ?? null,
            lastAt: Math.max(...rows.map((r) => worked.get(r.id) as number)),
            open: p?.status === "in_progress",
            runCount: rows.length,
            figures: [{ id: "best", value: p?.bestScore ?? null, share: true }],
            runs: [],
          },
        };
      }),
    );
    const courses = [...new Set(lessons.map((l) => l.course))].map((key) => {
      const course = installed.find((c) => c.key === key);
      const place = (k: LessonKey) => {
        const i = course?.lessons.indexOf(k) ?? -1;
        return i < 0 ? Number.MAX_SAFE_INTEGER : i;
      };
      const mine = lessons.filter((l) => l.course === key);
      // The course's title in the edition of its latest work.
      const latest = mine.reduce((a, b) => (b.entry.lastAt > a.entry.lastAt ? b : a));
      const group = { key, title: course ? courseTitle(course, [latest.edition]) : null };
      const own = mine
        .map((l) => ({ ...l.entry, group }))
        .sort((a, b) => place(a.key) - place(b.key) || a.key.localeCompare(b.key));
      return { lastAt: Math.max(...own.map((l) => l.lastAt)), own };
    });
    return {
      module: "lesson",
      figures: [{ id: "lessonsDone", value: Object.values(byLesson).filter(lessonDone).length }],
      entries: courses.sort((a, b) => b.lastAt - a.lastAt).flatMap((c) => c.own),
    };
  }

  /** Each lesson's state for the course map, read like the player reads it. `byLesson` is
   *  `progress()` when the caller has it already. */
  const lessonStates = async (
    lessons: LessonKey[],
    byLesson?: Awaited<ReturnType<typeof progress>>,
  ): Promise<Record<string, LessonState>> => {
    const progressOf = byLesson ?? (await progress());
    const out: Record<string, LessonState> = {};
    for (const key of lessons) {
      let row = await shownRun(key);
      // An active run nothing was done in yet (opened, or started over) is no progress, as the
      // course counts it: the lesson shows its latest completed run, or none.
      if (row?.status === "active" && progressOf[key]?.status !== "in_progress")
        row = store.list("lesson", key).find(completed);
      if (!row) continue;
      const lesson = await lessonOf(row);
      if (!lesson) continue;
      const coverage = lessonCoverage(lesson, exerciseResults(store.events(row.id)));
      const result = toRun(row).result;
      out[key] = {
        done: lessonDone(progressOf[key]),
        run: {
          status: row.status === "active" ? "active" : "finished",
          worked: coverage.worked,
          total: coverage.total,
          ...(result?.scored ? { score: result.score } : {}),
        },
      };
    }
    return out;
  };

  return {
    progress,
    standing,

    /** The installed courses (not the exams: the Exams section's) with the learner's progress and
     *  the lesson to go on with, as its card shows it (its title in each edition, exercises worked). */
    async courses() {
      const byLesson = await progress();
      const courses = (await content.courses()).filter((c) => c.kind === "course");
      return Promise.all(
        courses.map(async ({ lessons, exams: _, kind: __, ...course }) => {
          const at = courseProgress(lessons, byLesson);
          const next = at.next as LessonKey | null;
          const nextTitles: Record<string, string> = {};
          if (next)
            for (const edition of course.editions) {
              const locale = await content.localeLesson(course.series, next, edition);
              if (locale) nextTitles[edition] = locale.title;
            }
          const state = next && (await lessonStates([next], byLesson))[next];
          return {
            ...course,
            lessons: lessons.length,
            ...at,
            nextTitles,
            nextRun: state?.run ?? null,
          };
        }),
      );
    },

    /** One of the lesson's runs, if `runId` is one (explanations are kept in lesson runs). */
    lessonRun(lessonKey: LessonKey, runId: string): Run | undefined {
      const row = store.get(runId, "lesson", lessonKey);
      return row && toRun(row);
    },

    /** The run the lesson shows, with its events (for the tutor). */
    async shown(lessonKey: LessonKey): Promise<{ run: Run; events: TypedEvent[] } | undefined> {
      const row = await shownRun(lessonKey);
      return row && { run: toRun(row), events: store.events(row.id) };
    },

    lessonStates,

    /**
     * What the lesson shows on opening, without starting anything: its active run, else
     * its latest completed run (read-only), else null.
     */
    async lessonState(series: string, lessonKey: LessonKey) {
      const row = await shownRun(lessonKey);
      if (!row?.courseKey?.startsWith(`${series}/`)) return null;
      return openState(row);
    },

    /** The active run of the lesson, or a new one; `restart` ends the active one first. Everything is
     *  checked before anything is written. */
    async start(series: string, lessonKey: LessonKey, edition: string, restart = false) {
      if (seriesOf(lessonKey) !== series) throw new ServiceError("lesson_not_in_series");
      await content.lesson(series, lessonKey);
      const row = store.atomic(() => {
        const active = store.active("lesson", lessonKey);
        if (active && !restart && active.edition === edition) return active;
        // A run belongs to one edition; switching editions (or starting over) leaves the old one
        // unfinished; it stays readable.
        return store.replace(
          "lesson",
          lessonKey,
          { status: "abandoned", reason: "user" },
          { edition },
        );
      });
      return openState(row);
    },

    /**
     * Appends events idempotently (by id): the batch is checked whole, then stored in one transaction,
     * entirely or not at all; an id stored before is left as it is. Returns the outcome and the attempt
     * of each `answered` event of the batch — the stored ones for an event sent again. An answer's
     * attempt is numbered here, after the item's answers the run holds: two devices answering in one
     * run never give two answers the same number.
     */
    async append(
      runId: string,
      input: unknown[],
      deviceId?: string,
    ): Promise<{ outcomes: Record<string, Outcome>; attempts: Record<string, number> }> {
      const row = getRun(runId);
      if (row.status !== "active") throw new ServiceError("run_not_active", 409);
      const parsed = new Map<string, EventInput>();
      for (const e of input) {
        const result = EventInput.safeParse(e);
        if (!result.success) throw new ServiceError("invalid_event");
        if (!parsed.has(result.data.id)) parsed.set(result.data.id, result.data);
      }
      if (!row.edition) throw new ServiceError("run_without_edition", 409);
      const series = seriesOf(row.contextKey as LessonKey);
      const lesson = await content.lesson(series, row.contextKey as LessonKey);
      const locale = await content.localeLesson(series, lesson.key, row.edition);
      // Answers are checked in the language the edition teaches (case rules differ, 04).
      const target = parseEditionId(row.edition).target;
      // An exercise's snapshot is kept with the first time it was shown in the run.
      const snapshotted = new Set(
        store
          .payloads(runId, "page_shown")
          .flatMap((p) => (p.snapshot ? [p.snapshot.exercise.key as string] : [])),
      );
      const list: NewEvent[] = [...parsed.values()].map((e): NewEvent => {
        const itemOf = (key: string) => {
          const { exercise: exKey, n } = parseItemKey(key as ItemKey);
          const exercise = findExercise(lesson, exKey);
          if (!exercise) throw new ServiceError("no_such_item");
          return { exercise, n };
        };
        switch (e.type) {
          case "answered": {
            const { exercise, n } = itemOf(e.itemKey);
            let outcome: Outcome;
            try {
              outcome = checkItem(exercise, n - 1, e.payload.answer, target);
            } catch {
              throw new ServiceError("answer_does_not_fit");
            }
            // Numbered by the store, after the item's answers the run holds.
            return { ...e, payload: { ...e.payload, outcome } };
          }
          case "item_skipped":
            itemOf(e.itemKey);
            return { ...e, payload: {} };
          case "page_shown": {
            const { pageIndex } = e.payload;
            const exercise = lesson.pages[pageIndex]?.exercise;
            if (!exercise) return { ...e, payload: { pageIndex } };
            const shown = { pageIndex, exerciseKey: exercise.key };
            if (snapshotted.has(exercise.key)) return { ...e, payload: shown };
            snapshotted.add(exercise.key);
            const snapshot = { exercise, locale: locale?.exercises[exercise.key] ?? null };
            return { ...e, payload: { ...shown, snapshot } };
          }
          default:
            return e;
        }
      });
      return appendAnswers(store, runId, list, { deviceId });
    },

    /** Finishes a run once every step of the plan is done or skipped; the result is the lesson score. */
    async finish(runId: string) {
      const row = getRun(runId);
      if (row.status !== "active") return toRun(row);
      const series = seriesOf(row.contextKey as LessonKey);
      const lesson = await content.lesson(series, row.contextKey as LessonKey);
      const locale = row.edition
        ? await content.localeLesson(series, lesson.key, row.edition)
        : undefined;
      const list = store.events(runId);
      const steps = lessonSteps(lesson, locale);
      if (!planCoverage(steps, lesson, exerciseResults(list), stepsDone(list)).complete)
        throw new ServiceError("run_incomplete", 409);
      // Only an active run finishes: one started over meanwhile stays abandoned.
      const finished = store.end(runId, "finished", "completed", lessonResult(lesson, list));
      return toRun(finished ?? getRun(runId));
    },
  };
}
export type Runs = ReturnType<typeof createRuns>;
