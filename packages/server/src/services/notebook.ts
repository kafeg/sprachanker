// The Notebook (09): what the learner did, read from the runs — study days (the engine's activity), the
// totals (words known, lessons done), lessons with their passes,
// a pass in full (its events, the exercises as shown, explanations, writing checks, words added, chats
// and scenes held meanwhile), and one item across passes. Read only; storage goes through the run store,
// chats and scenes through their services.
import {
  ACTIVITY_EVENTS,
  activityByDay,
  type DeckWord,
  deckStanding,
  exerciseResults,
  type LessonProgress,
  lessonCoverage,
  lessonDone,
  studyDay,
} from "@sprachanker/engine";

import {
  type AnsweredPayload,
  type ExamKey,
  type ExamRun,
  type ItemKey,
  type LessonKey,
  lessonOf,
  parseItemKey,
  seriesOf,
  type VerdictTask,
} from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import type { CardStore } from "./card-store.ts";
import type { Content } from "./content.ts";
import { toExamRun } from "./exams.ts";
import { payloadOf, type ReadEvent, type RunRow, type RunStore } from "./run-store.ts";
import { toRun, WORK_EVENTS } from "./runs.ts";
import type { Scenes } from "./scene.ts";
import type { Tutor } from "./tutor.ts";

export function createNotebook(deps: {
  store: RunStore;
  content: Content;
  cards: CardStore;
  tutor: Tutor;
  scenes: Scenes;
  /** Each lesson's progress (the runs service's). */
  progress: () => Promise<Record<string, LessonProgress>>;
  /** The hour the learner's day starts (the Review settings). */
  dayStartHour: () => number;
  now: () => number;
}) {
  const { store, content } = deps;
  const dayOf = (t: number) => studyDay(t, deps.dayStartHour());

  /** A lesson's passes with work in them (a lesson only opened is none), newest first. */
  function passes(lessonKey: LessonKey) {
    const worked = store.lastActivity([...WORK_EVENTS]);
    return store
      .list("lesson", lessonKey)
      .filter((r) => worked.has(r.id))
      .map((row) => ({ row, lastAt: worked.get(row.id) as number }));
  }

  /** The chats and scenes about a lesson begun during each pass: from its start until the next pass
   *  of the lesson began. */
  function heldDuring(lessonKey: LessonKey, rows: RunRow[]) {
    const starts = store
      .list("lesson", lessonKey)
      .map((r) => r.startedAt)
      .sort((a, b) => a - b);
    const until = (row: RunRow) =>
      starts.find((s) => s > row.startedAt) ?? Number.POSITIVE_INFINITY;
    const chats = deps.tutor.chats(lessonKey, Number.POSITIVE_INFINITY);
    const scenes = deps.scenes.list(lessonKey, Number.POSITIVE_INFINITY);
    return new Map(
      rows.map((row) => {
        const inside = (at: number) => at >= row.startedAt && at < until(row);
        return [
          row.id,
          {
            chats: chats
              .filter((c) => inside(c.startedAt))
              .map((c) => ({ id: c.id, startedAt: c.startedAt, title: c.title, turns: c.turns })),
            scenes: scenes
              .filter((s) => inside(s.startedAt))
              .map((s) => ({
                id: s.id,
                startedAt: s.startedAt,
                title: s.setup.title,
                goalsMet: s.goalsMet.length,
                goals: s.setup.goals.length,
              })),
          },
        ];
      }),
    );
  }

  /** A lesson's title in an edition, if the lesson is still installed. */
  const titleOf = (lessonKey: LessonKey, edition: string | null) =>
    edition
      ? content
          .localeLesson(seriesOf(lessonKey), lessonKey, edition)
          .then((l) => l?.title)
          .catch(() => undefined)
      : Promise.resolve(undefined);

  const verdictCount = (events: ReadEvent[], task: VerdictTask) =>
    events.filter((e) => e.type === "llm_verdict" && e.payload.task === task).length;

  /** Checks of answers said aloud (08), newest first: by item and the words heard. */
  const spokenChecks = (where: Parameters<RunStore["verdicts"]>[1]) =>
    store.verdicts("speaking", where).map((v) => ({
      runId: v.runId,
      itemKey: v.itemKey,
      transcript: v.input,
      result: v.result,
      model: v.model,
      ts: v.ts,
    }));

  return {
    /**
     * The Notebook's first page: every study day with something done (oldest first, what each held)
     * and today's start; the words known (every face of the note in review) and the lessons done; the
     * courses with the lessons worked on — passes, best score, one open, last work; the mock exams
     * handed in.
     */
    async overview() {
      const examRuns = new Set(
        store.eventsWhere({ types: ["answered"], kind: "exam" }).map((e) => e.runId),
      );
      const days = activityByDay(
        store.eventsWhere({ types: [...ACTIVITY_EVENTS] }),
        (t) => dayOf(t).start,
        examRuns,
      );
      const states = deps.cards.states();
      const wordsKnown = deps.cards
        .all()
        .filter((note) =>
          deps.cards
            .facesOf(note)
            .every((face) => deps.cards.stateOf(states.get(`${note.id}:${face}`))?.state === 2),
        ).length;
      const lessonsDone = Object.values(await deps.progress()).filter(lessonDone).length;

      const worked = store.lastActivity([...WORK_EVENTS]);
      const byLesson = new Map<LessonKey, RunRow[]>();
      for (const row of store.all("lesson")) {
        if (!worked.has(row.id)) continue;
        const key = row.contextKey as LessonKey;
        byLesson.set(key, [...(byLesson.get(key) ?? []), row]);
      }
      const installed = await content.courses();
      const lessons = await Promise.all(
        [...byLesson].map(async ([key, rows]) => {
          const latest = rows.at(-1) as RunRow;
          const scores = rows.flatMap((r) => {
            const result = toRun(r).result;
            return r.status === "finished" && result?.scored ? [result.score] : [];
          });
          return {
            key,
            course: latest.courseKey as string,
            title: (await titleOf(key, latest.edition)) ?? null,
            passes: rows.length,
            best: scores.length ? Math.max(...scores) : null,
            open: rows.some((r) => r.status === "active"),
            lastAt: Math.max(...rows.map((r) => worked.get(r.id) as number)),
          };
        }),
      );
      const courses = [...new Set(lessons.map((l) => l.course))].map((key) => {
        const course = installed.find((c) => c.key === key);
        // In the course's order (its index), not by key: a key kept through a reorder says nothing
        // of where the lesson is now. A lesson no longer in the course comes last.
        const place = (k: LessonKey) => {
          const i = course?.lessons.indexOf(k) ?? -1;
          return i < 0 ? Number.MAX_SAFE_INTEGER : i;
        };
        const own = lessons
          .filter((l) => l.course === key)
          .sort((a, b) => place(a.key) - place(b.key) || a.key.localeCompare(b.key));
        return {
          key,
          title: course?.titles[course.editions[0] ?? ""] ?? null,
          lastAt: Math.max(...own.map((l) => l.lastAt)),
          lessons: own,
        };
      });
      // The mock exams handed in, by exam, newest first (practice is the questions' history).
      const byExam = new Map<ExamKey, ExamRun[]>();
      for (const row of store.all("exam")) {
        const run = toExamRun(row);
        if (run?.status !== "finished" || run.plan.mode !== "test") continue;
        byExam.set(run.exam, [run, ...(byExam.get(run.exam) ?? [])]);
      }
      const exams = await Promise.all(
        [...byExam].map(async ([key, runs]) => {
          const edition = runs[0]?.edition;
          const locale = edition
            ? await content.localeExam(seriesOf(key), key, edition).catch(() => undefined)
            : undefined;
          return { key, title: locale?.title ?? null, runs };
        }),
      );
      // Each language's deck: its words by state, what is due, its answers of the month.
      const today = dayOf(deps.now()).start;
      const notes = deps.cards.all();
      const cardEvents = store.eventsWhere({ types: ["card_review", "card_undo"] });
      const decks = [...new Set(notes.map((n) => n.lang))].sort().map((language) => {
        const own = notes.filter((n) => n.lang === language);
        const ids = new Set(own.map((n) => n.id));
        const words: DeckWord[] = own.map((note) => ({
          suspended: !!note.suspended,
          faces: deps.cards.facesOf(note).map((face) => {
            const row = states.get(`${note.id}:${face}`);
            const state = deps.cards.stateOf(row);
            return { ...(state && { state }), suspended: !!row?.suspended };
          }),
        }));
        const deckDays = activityByDay(
          cardEvents.filter((e) => e.cardId && ids.has(e.cardId)),
          (t) => dayOf(t).start,
        );
        return { language, ...deckStanding(words, deckDays, today) };
      });
      return {
        days,
        today,
        decks,
        wordsKnown,
        lessonsDone,
        courses: courses.sort((a, b) => b.lastAt - a.lastAt),
        exams: exams.sort((a, b) => (b.runs[0]?.finishedAt ?? 0) - (a.runs[0]?.finishedAt ?? 0)),
      };
    },

    /** A lesson's passes, newest first: when, the score, exercises worked, and what else was done. */
    async lesson(lessonKey: LessonKey) {
      const list = passes(lessonKey);
      const lesson = await content.lesson(seriesOf(lessonKey), lessonKey).catch(() => undefined);
      const events = store.eventsOf(list.map((p) => p.row.id));
      const held = heldDuring(
        lessonKey,
        list.map((p) => p.row),
      );
      return {
        title: (await titleOf(lessonKey, list[0]?.row.edition ?? null)) ?? null,
        passes: list.map(({ row, lastAt }) => {
          const own = events.get(row.id) ?? [];
          const results = exerciseResults(own);
          const coverage = lesson && lessonCoverage(lesson, results);
          return {
            ...toRun(row),
            endedAt: row.finishedAt ?? lastAt,
            worked: coverage ? coverage.worked : Object.keys(results).length,
            total: coverage ? coverage.total : null,
            explanations: verdictCount(own, "explain"),
            writing: verdictCount(own, "writing"),
            words: deps.cards.madeIn(row.id).length,
            chats: held.get(row.id)?.chats.length ?? 0,
            scenes: held.get(row.id)?.scenes.length ?? 0,
          };
        }),
      };
    },

    /** One pass in full: its run and events, the lesson as installed now (the events carry the
     *  exercises as shown), explanations, writing checks, words added, chats and scenes. */
    async pass(runId: string) {
      const row = store.get(runId, "lesson");
      if (!row) throw new ServiceError("no_such_run", 404);
      const lessonKey = row.contextKey as LessonKey;
      const now = row.edition
        ? await content
            .lessonWithLocale(seriesOf(lessonKey), lessonKey, row.edition)
            .catch(() => undefined)
        : undefined;
      const held = heldDuring(lessonKey, [row]).get(row.id);
      return {
        run: toRun(row),
        events: store.events(runId),
        lesson: now?.lesson ?? null,
        locale: now?.locale ?? null,
        explanations: store
          .verdicts("explain", { runIds: [runId] })
          .map((v) => ({ itemKey: v.itemKey, attempt: v.attempt, text: v.result, ts: v.ts })),
        spoken: spokenChecks({ runIds: [runId] }),
        writing: store
          .verdicts("writing", { runIds: [runId] })
          .map((v) => ({ ts: v.ts, text: v.input, verdict: v.result.verdict })),
        words: deps.cards.madeIn(runId).map((w) => w.display),
        chats: held?.chats ?? [],
        scenes: held?.scenes ?? [],
      };
    },

    /** One item in every pass that answered it, newest pass first: each answer with its outcome, and
     *  the explanations kept for it. */
    item(itemKey: ItemKey) {
      const lessonKey = lessonOf(parseItemKey(itemKey).exercise);
      const where = { kind: "lesson" as const, about: lessonKey, itemKey };
      const answered = store.eventsWhere({ types: ["answered"], ascending: true, ...where });
      const explained = store.verdicts("explain", where);
      const spoken = spokenChecks(where);
      return store.list("lesson", lessonKey).flatMap((row) => {
        const answers = answered
          .filter((e) => e.runId === row.id)
          .map((e) => payloadOf<AnsweredPayload>(e));
        if (!answers.length) return [];
        return [
          {
            runId: row.id,
            startedAt: row.startedAt,
            answers,
            explanations: explained
              .filter((v) => v.runId === row.id)
              .map((v) => ({ attempt: v.attempt, text: v.result }))
              .reverse(),
            spoken: spoken.filter((v) => v.runId === row.id),
          },
        ];
      });
    },
  };
}
export type Notebook = ReturnType<typeof createNotebook>;
