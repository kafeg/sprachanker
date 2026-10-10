// A lesson's journal in the Notebook (09; owner's choice A, 2026-10-07), a part of the lessons module:
// its passes, a pass in full (its events, the exercises as shown, explanations, writing checks, words
// added, chats and scenes held meanwhile), and one item across passes. Read only, through the run
// store; the cards a pass made through the card store; the chats and scenes about the lesson are
// handed in (the AI practice's own services).
import { exerciseResults, LESSON_WORK, lessonCoverage } from "@sprachanker/engine";
import {
  type AnsweredPayload,
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
import { payloadOf, type ReadEvent, type RunRow, type RunStore } from "./run-store.ts";
import { lessonTitle, toRun } from "./runs.ts";
import { verdicts } from "./verdicts.ts";

/** A chat with the tutor about a lesson, as its history lists it. */
interface HeldChat {
  id: string;
  startedAt: number;
  title: string;
  turns: number;
}
/** A scene of a lesson, as its history lists it. */
interface HeldScene {
  id: string;
  startedAt: number;
  setup: { title: string; goals: unknown[] };
  goalsMet: unknown[];
}

export function createLessonJournal(deps: {
  store: RunStore;
  content: Content;
  cards: CardStore;
  /** The lesson's chats and scenes, every one (the tutor's and the scenes' services). */
  chats: (lessonKey: LessonKey) => HeldChat[];
  scenes: (lessonKey: LessonKey) => HeldScene[];
}) {
  const { store, content } = deps;

  /** A lesson's passes with work in them (a lesson only opened is none), newest first. */
  function passes(lessonKey: LessonKey) {
    const worked = store.lastActivity([...LESSON_WORK]);
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
    const chats = deps.chats(lessonKey);
    const scenes = deps.scenes(lessonKey);
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

  const verdictCount = (events: ReadEvent[], task: VerdictTask) =>
    events.filter((e) => e.type === "llm_verdict" && e.payload.task === task).length;

  return {
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
        title: (await lessonTitle(content, lessonKey, list[0]?.row.edition ?? null)) ?? null,
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
        explanations: verdicts(store, "explain", { runIds: [runId] }),
        spoken: verdicts(store, "speaking", { runIds: [runId] }),
        writing: verdicts(store, "writing", { runIds: [runId] }),
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
      const explained = verdicts(store, "explain", where);
      const spoken = verdicts(store, "speaking", where);
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
            explanations: explained.filter((v) => v.runId === row.id).reverse(),
            spoken: spoken.filter((v) => v.runId === row.id),
          },
        ];
      });
    },
  };
}
export type LessonJournal = ReturnType<typeof createLessonJournal>;
