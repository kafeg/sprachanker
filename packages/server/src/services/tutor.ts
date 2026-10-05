// The lesson tutor: one chat per lesson, stored as a `chat` run with `llm_turn` events (05, 07).
import { type ChatTurnInput, chatTurn } from "@sprachanker/llm";
import {
  type LessonKey,
  LlmTurnPayload,
  parseEditionId,
  parseLessonKey,
} from "@sprachanker/schema";
import { and, asc, eq } from "drizzle-orm";
import { monotonicFactory } from "ulid";
import type { ProfileDb } from "../db/profile/db.ts";
import { events, runs } from "../db/profile/schema.ts";
import type { Content } from "./content.ts";
import type { Llm } from "./llm.ts";

export interface TutorRequest {
  series: string;
  lessonKey: LessonKey;
  edition: string;
  /** The exercise on screen, if any. */
  exerciseKey?: string;
  message: string;
  language: string;
}

export function createTutor(deps: {
  db: ProfileDb;
  content: Content;
  llm: Llm;
  now: () => number;
  appVersion: string;
}) {
  const { db, content, now } = deps;
  const id = monotonicFactory();

  const activeRun = (lessonKey: string) =>
    db
      .select()
      .from(runs)
      .where(and(eq(runs.kind, "chat"), eq(runs.contextKey, lessonKey), eq(runs.status, "active")))
      .get();

  const turns = (runId: string): LlmTurnPayload[] =>
    db
      .select()
      .from(events)
      .where(and(eq(events.runId, runId), eq(events.type, "llm_turn")))
      .orderBy(asc(events.ts), asc(events.id))
      .all()
      .map((e) => LlmTurnPayload.parse(JSON.parse(e.payloadJson)));

  const addTurns = (runId: string, list: LlmTurnPayload[]) =>
    db.transaction((tx) => {
      for (const payload of list) {
        tx.insert(events)
          .values({
            id: id(now()),
            runId,
            ts: now(),
            type: "llm_turn",
            payloadJson: JSON.stringify(payload),
          })
          .run();
      }
    });

  /** What the tutor knows about the course: this lesson in full, earlier lessons as words and titles. */
  async function context(series: string, lessonKey: LessonKey, edition: string) {
    const course = parseLessonKey(lessonKey).course.split("/").pop() ?? "";
    const [map, lesson, locale] = await Promise.all([
      content.courseMap(series, course, edition),
      content.lesson(series, lessonKey),
      content.localeLesson(series, lessonKey, edition),
    ]);
    const order = map.index.units.flatMap((u) => u.lessons);
    const earlier = order.slice(0, Math.max(0, order.indexOf(lessonKey)));
    const earlierVocab = await Promise.all(
      earlier.map(async (k) => (await content.lesson(series, k)).vocab.map((v) => v.target)),
    );
    return {
      lesson,
      locale,
      input: {
        target: parseEditionId(edition).target,
        lesson: {
          title: locale?.title ?? lessonKey,
          goals: lesson.goals.flatMap((g) => map.locale?.goals[g]?.text ?? []),
          grammarHtml: locale?.tabs.grammar.map((t) => t.bodyHtml) ?? [],
          vocab: lesson.vocab.map((v) => ({
            target: v.target,
            translation: locale?.vocab[v.key]?.translation,
          })),
        },
        knownVocab: [...new Set(earlierVocab.flat())],
        earlierLessons: earlier.map((k) => map.titles[k] ?? k),
      } satisfies Partial<ChatTurnInput>,
    };
  }

  return {
    /** Turns of the lesson's current chat. */
    history(lessonKey: string): LlmTurnPayload[] {
      const run = activeRun(lessonKey);
      return run ? turns(run.id) : [];
    },

    /** Sends a message; the reply is streamed. Both turns are stored once the reply has text. */
    async send(request: TutorRequest, signal?: AbortSignal): Promise<AsyncIterable<string>> {
      const { client, model } = await deps.llm.model();
      const { lesson, locale, input } = await context(
        request.series,
        request.lessonKey,
        request.edition,
      );
      const exercise = lesson.pages.find((p) => p.exercise.key === request.exerciseKey)?.exercise;
      const run =
        activeRun(request.lessonKey) ??
        db
          .insert(runs)
          .values({
            id: id(now()),
            kind: "chat",
            contextKey: request.lessonKey,
            courseKey: parseLessonKey(request.lessonKey).course,
            edition: request.edition,
            appVersion: deps.appVersion,
            status: "active",
            startedAt: now(),
          })
          .returning()
          .get();
      const history = turns(run.id);
      const reply = chatTurn(
        client,
        model,
        {
          ...input,
          language: request.language,
          exercise: exercise && { exercise, locale: locale?.exercises[exercise.key] },
          history: history.map((t) => ({ role: t.role, text: t.text })),
          message: request.message,
        },
        signal,
      );
      return (async function* () {
        let text = "";
        try {
          for await (const chunk of reply) {
            text += chunk;
            yield chunk;
          }
        } finally {
          // Also keeps a reply cut short by the learner; nothing is stored if the model never answered.
          if (text.trim()) {
            addTurns(run.id, [
              { role: "user", text: request.message, exerciseKey: exercise?.key },
              { role: "assistant", text: text.trim(), model },
            ]);
          }
        }
      })();
    },

    /** Ends the lesson's chat; the next message starts a new one. */
    reset(lessonKey: string) {
      const run = activeRun(lessonKey);
      if (!run) return;
      db.update(runs)
        .set({ status: "finished", endReason: "user", finishedAt: now() })
        .where(eq(runs.id, run.id))
        .run();
    },
  };
}
export type Tutor = ReturnType<typeof createTutor>;
