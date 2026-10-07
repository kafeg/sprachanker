// The Notebook (09): what the learner did, read from the runs — study days, lessons with their passes,
// a pass in full (its events, the exercises as shown, explanations, writing checks, words added, chats
// and scenes held meanwhile), and one item across passes. Read only; storage goes through the run store,
// chats and scenes through their services.
import { exerciseResults, lessonCoverage, studyDay } from "@sprachanker/engine";
import { WritingCheck } from "@sprachanker/llm";
import {
  type AnsweredPayload,
  type EventType,
  type ItemKey,
  type LessonKey,
  type LlmTurnPayload,
  type LlmVerdictPayload,
  lessonOf,
  parseItemKey,
  seriesOf,
} from "@sprachanker/schema";
import { z } from "zod";
import { ServiceError } from "../errors.ts";
import type { CardStore } from "./card-store.ts";
import type { Content } from "./content.ts";
import { payloadOf, type RunRow, type RunStore } from "./run-store.ts";
import { toRun, WORK_EVENTS } from "./runs.ts";
import type { Scenes } from "./scene.ts";
import type { Tutor } from "./tutor.ts";

/** How many study days the Notebook's strip shows, today last. */
export const NOTEBOOK_DAYS = 14;

/** What the learner did on a day: lesson work, card answers, messages, checks. */
const DAY_EVENTS: EventType[] = [...WORK_EVENTS, "card_review", "llm_turn", "llm_verdict"];

export function createNotebook(deps: {
  store: RunStore;
  content: Content;
  cards: CardStore;
  tutor: Tutor;
  scenes: Scenes;
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

  const verdictCount = (events: Array<{ type: string; payload: unknown }>, task: string) =>
    events.filter((e) => e.type === "llm_verdict" && (e.payload as LlmVerdictPayload).task === task)
      .length;

  return {
    /**
     * The Notebook's first page: the last study days with how much was done on each (oldest first),
     * and the courses with the lessons worked on — passes, best score, one open, last work.
     */
    async overview() {
      const starts: number[] = [];
      let start = dayOf(deps.now()).start;
      while (starts.length < NOTEBOOK_DAYS) {
        starts.unshift(start);
        start = dayOf(start - 1).start;
      }
      const counts = new Map(starts.map((s) => [s, 0]));
      for (const e of store.eventsWhere({ types: DAY_EVENTS, since: starts[0] })) {
        if (e.type === "llm_turn" && (e.payload as LlmTurnPayload).role !== "user") continue;
        const day = dayOf(e.ts).start;
        counts.set(day, (counts.get(day) ?? 0) + 1);
      }

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
        const own = lessons
          .filter((l) => l.course === key)
          .sort((a, b) => a.key.localeCompare(b.key));
        return {
          key,
          title: course?.titles[course.editions[0] ?? ""] ?? null,
          lastAt: Math.max(...own.map((l) => l.lastAt)),
          lessons: own,
        };
      });
      return {
        days: starts.map((start) => ({ start, count: counts.get(start) ?? 0 })),
        courses: courses.sort((a, b) => b.lastAt - a.lastAt),
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
          .verdicts("explain", z.string(), { runIds: [runId] })
          .map((v) => ({ itemKey: v.itemKey, attempt: v.attempt, text: v.result, ts: v.ts })),
        writing: store
          .verdicts("writing", WritingCheck, { runIds: [runId] })
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
      const explained = store.verdicts("explain", z.string(), where);
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
          },
        ];
      });
    },
  };
}
export type Notebook = ReturnType<typeof createNotebook>;
