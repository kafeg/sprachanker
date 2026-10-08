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
  type AnsweredPayload,
  type CourseKey,
  EventInput,
  findExercise,
  type ItemKey,
  type LessonKey,
  LessonResult,
  type Outcome,
  parseEditionId,
  parseItemKey,
  type Run,
  recordingOf,
  type StoredEvent,
  seriesOf,
} from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import type { CardStore } from "./card-store.ts";
import type { Content } from "./content.ts";
import type { Recordings } from "./recordings.ts";
import { type NewEvent, payloadOf, type RunRow, type RunStore, readStored } from "./run-store.ts";

export const toRun = (r: RunRow): Run => ({
  id: r.id,
  kind: r.kind as Run["kind"],
  contextKey: r.contextKey as LessonKey | null,
  courseKey: r.courseKey,
  edition: r.edition,
  status: r.status as Run["status"],
  endReason: r.endReason as Run["endReason"],
  startedAt: r.startedAt,
  finishedAt: r.finishedAt,
  result: readStored(r.resultJson, LessonResult, `result of run ${r.id}`) ?? null,
});

/** What counts as work done in a lesson run (the engine's `LESSON_WORK`). */
export const WORK_EVENTS = LESSON_WORK;

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

export function createRuns({
  store,
  cards,
  content,
  recordings,
}: {
  store: RunStore;
  /** The cards a run made go with it when progress is reset. */
  cards: CardStore;
  content: Content;
  /** And the recordings its answers hold. */
  recordings: Pick<Recordings, "remove">;
}) {
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
   * A finished run counts as completed only when every exercise of the lesson was answered or skipped
   * in it. Runs finished before that was enforced (by merely opening the summary) are no completions:
   * they are not shown and not counted. Kept per run; dropped when the course's files change.
   */
  const complete = new Map<string, boolean>();
  const completed = async (row: RunRow) => {
    if (row.status !== "finished") return false;
    if (!complete.has(row.id)) {
      // A lesson that cannot be read is not counted, and asked again next time.
      const lesson = await lessonOf(row);
      if (!lesson) return false;
      complete.set(row.id, lessonCoverage(lesson, exerciseResults(store.events(row.id))).complete);
    }
    return complete.get(row.id) as boolean;
  };

  /**
   * The run a lesson shows — in the player, on the course map and to the tutor: its active
   * run (a lesson has one, in whichever edition it was started), else its latest completed run.
   */
  const shownRun = async (lessonKey: LessonKey) => {
    const lessonRuns = store.list("lesson", lessonKey);
    const active = lessonRuns.find((r) => r.status === "active");
    if (active) return active;
    for (const r of lessonRuns) if (await completed(r)) return r;
    return undefined;
  };

  /** A run as the player opens it: the run, its events, and the page to go on with. */
  const openState = (row: RunRow) => {
    const list = store.events(row.id);
    return { run: toRun(row), events: list, resumePage: resumePage(list) };
  };

  /** Lesson progress of every lesson with runs, over active and completed runs. An active run counts
   *  as "in progress" only once something was answered, skipped or a step done in it. */
  const progress = async () => {
    // Work done in the run: an answer, a skip, or a step of the plan (words, a page read, practice).
    const activity = store.lastActivity([...WORK_EVENTS]);
    const counted: Run[] = [];
    for (const row of store.all("lesson"))
      if (row.status === "active" || (await completed(row))) counted.push(toRun(row));
    return Object.fromEntries(lessonProgress(counted, activity));
  };

  /** Each lesson's state for the course map, read like the player reads it. `byLesson` is
   *  `progress()` when the caller has it already. */
  const lessonStates = async (
    lessons: LessonKey[],
    byLesson?: Awaited<ReturnType<typeof progress>>,
  ): Promise<Record<string, LessonState>> => {
    const progressOf = byLesson ?? (await progress());
    const out: Record<string, LessonState> = {};
    for (const key of lessons) {
      const row = await shownRun(key);
      if (!row) continue;
      const lesson = await lessonOf(row);
      if (!lesson) continue;
      const coverage = lessonCoverage(lesson, exerciseResults(store.events(row.id)));
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
  };

  return {
    progress,

    /** Forgets what was worked out from a course's lessons (its files were replaced). */
    forget(course: string) {
      for (const row of store.all("lesson")) if (row.courseKey === course) complete.delete(row.id);
    },

    /** The installed courses with the learner's progress and the lesson to go on with, as its card
     *  shows it (title and exercises worked). */
    async courses() {
      const byLesson = await progress();
      return Promise.all(
        (await content.courses()).map(async ({ lessons, ...course }) => {
          const at = courseProgress(lessons, byLesson);
          const next = at.next as LessonKey | null;
          const edition = course.editions[0];
          const locale =
            next && edition && (await content.localeLesson(course.series, next, edition));
          const state = next && (await lessonStates([next], byLesson))[next];
          return {
            ...course,
            lessons: lessons.length,
            ...at,
            nextTitle: locale ? locale.title : null,
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
    async shown(lessonKey: LessonKey): Promise<{ run: Run; events: StoredEvent[] } | undefined> {
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

    /**
     * Resets the learner's progress in a course, or in one of its lessons: every run of it — lesson
     * runs, tutor chats, writing checks, scenes — and their events are deleted, and so are the cards
     * it made (the words first met there, by the lesson each card names — also when the run that made
     * it is long gone) with their answers, and the recordings its answers hold. A card another lesson
     * made stays. The only deletion of events besides removing a profile; the screen asks for
     * confirmation (05).
     */
    reset(course: CourseKey, lesson?: LessonKey) {
      const { removed, recordingIds } = store.atomic(() => {
        const scope = lesson ? { lesson } : { course };
        const runIds = store.idsOf(scope);
        const cardIds = cards.idsMetIn(scope);
        const recordingIds = [...store.eventsOf(runIds, ["answered"]).values()].flatMap((list) =>
          list.flatMap((e) => recordingOf(payloadOf<AnsweredPayload>(e).answer) ?? []),
        );
        const removed = store.remove(runIds, cardIds);
        cards.remove(cardIds);
        return { removed: { ...removed, cards: cardIds.length }, recordingIds };
      });
      // Files go once the rows are gone: a failed reset keeps both.
      if (recordingIds.length) recordings.remove(recordingIds);
      return removed;
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
     * entirely or not at all; an id stored before is left as it is. Returns the outcome of each
     * `answered` event of the batch — the stored one for an event sent again.
     */
    async append(runId: string, input: unknown[]): Promise<Record<string, Outcome>> {
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
      // A page's snapshot is kept with the first time it was shown in the run.
      const snapshotted = new Set(
        store.payloads(runId, "page_shown").flatMap((p) => (p.snapshot ? [p.pageIndex] : [])),
      );
      const outcomes: Record<string, Outcome> = {};
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
            outcomes[e.id] = outcome;
            return { ...e, payload: { ...e.payload, outcome } };
          }
          case "item_skipped":
            itemOf(e.itemKey);
            return { ...e, payload: {} };
          case "page_shown": {
            const { pageIndex } = e.payload;
            const exercise = lesson.pages[pageIndex]?.exercise;
            if (!exercise || snapshotted.has(pageIndex)) return { ...e, payload: { pageIndex } };
            snapshotted.add(pageIndex);
            const snapshot = { exercise, locale: locale?.exercises[exercise.key] ?? null };
            return { ...e, payload: { pageIndex, snapshot } };
          }
          default:
            return e;
        }
      });
      store.append(runId, list, {
        onStored: (before) => {
          if (before.type === "answered")
            outcomes[before.id] = (before.payload as { outcome: Outcome }).outcome;
          else delete outcomes[before.id];
        },
      });
      return outcomes;
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
