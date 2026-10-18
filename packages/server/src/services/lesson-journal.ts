// A lesson's journal in the Notebook (owner's choice A, 2026-10-07), a part of the lessons module:
// its passes, a pass in full (its events, the exercises as shown, explanations, writing checks,
// Understanding's texts, words added, chats and scenes held meanwhile), and one item across passes.
// Read only, through the run store; the cards a pass made through the card store; the chats and
// scenes about the lesson are handed in (the AI practice's own services).
import { exerciseResults, LESSON_WORK, lessonCoverage } from "@sprachanker/engine";
import {
  type AnsweredPayload,
  type ItemKey,
  type LessonKey,
  lessonOf,
  parseItemKey,
  seriesOf,
  type TypedEvent,
  type VerdictTask,
} from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import type { CardStore } from "./card-store.ts";
import type { Content } from "./content.ts";
import { lessonTitle, toRun } from "./lessons.ts";
import { payloadOf, type ReadEvent, type RunRow, type RunStore } from "./run-store.ts";
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
  /** A run's events as read, its answers said aloud judged (the lessons service). */
  judged: (row: RunRow, events: TypedEvent[]) => Promise<TypedEvent[]>;
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
            // Done: answered (one moved past without an answer is skipped, told apart).
            worked: coverage ? coverage.worked - coverage.skipped : Object.keys(results).length,
            skipped: coverage?.skipped ?? 0,
            total: coverage ? coverage.total : null,
            explanations: verdictCount(own, "explain"),
            writing: verdictCount(own, "writing"),
            understanding: verdictCount(own, "understanding"),
            words: deps.cards.madeIn(row.id).length,
            chats: held.get(row.id)?.chats.length ?? 0,
            scenes: held.get(row.id)?.scenes.length ?? 0,
          };
        }),
      };
    },

    /** One pass in full: its run and events, the lesson as installed now (the events carry the
     *  exercises as shown), explanations, writing checks, Understanding's texts, mistakes gone over,
     *  words added, chats and scenes. */
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
        events: await deps.judged(row, store.events(runId)),
        lesson: now?.lesson ?? null,
        locale: now?.locale ?? null,
        explanations: verdicts(store, "explain", { runIds: [runId] }),
        spoken: verdicts(store, "speaking", { runIds: [runId] }),
        writing: verdicts(store, "writing", { runIds: [runId] }),
        // Its answers are the run's `practice_answered` events, among `events`.
        understanding: verdicts(store, "understanding", { runIds: [runId] }),
        // Going over its mistakes: the answers to the new items among `events` too.
        mistakes: verdicts(store, "mistakes", { runIds: [runId] }),
        words: deps.cards.madeIn(runId).map((w) => w.display),
        chats: held?.chats ?? [],
        scenes: held?.scenes ?? [],
      };
    },

    /** One item in every pass that answered it, newest pass first: each answer with its outcome, and
     *  the explanations kept for it. */
    async item(itemKey: ItemKey) {
      const lessonKey = lessonOf(parseItemKey(itemKey).exercise);
      const where = { kind: "lesson" as const, about: lessonKey, itemKey };
      const answered = store.eventsWhere({ types: ["answered"], ascending: true, ...where });
      const explained = verdicts(store, "explain", where);
      const spoken = verdicts(store, "speaking", where);
      const passes = await Promise.all(
        store.list("lesson", lessonKey).map(async (row) => {
          const own = answered.filter((e) => e.runId === row.id);
          if (!own.length) return [];
          // Judged against the exercises as the run showed them.
          const shown = store.events(row.id, ["page_shown"]);
          const answers = (await deps.judged(row, [...shown, ...own]))
            .filter((e) => e.type === "answered")
            .map((e) => payloadOf<AnsweredPayload>(e));
          return [
            {
              runId: row.id,
              startedAt: row.startedAt,
              answers,
              explanations: explained.filter((v) => v.runId === row.id).reverse(),
              spoken: spoken.filter((v) => v.runId === row.id),
            },
          ];
        }),
      );
      return passes.flat();
    },
  };
}
export type LessonJournal = ReturnType<typeof createLessonJournal>;
