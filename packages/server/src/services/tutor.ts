// The lesson tutor: one chat per lesson, stored as a `chat` run with `llm_turn` events (05, 07).
import { type ChatTurnInput, chatTurn, chatTurnRequest, estimateTokens } from "@sprachanker/llm";
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
import type { LessonContexts } from "./lesson-context.ts";
import type { Llm, PromptPreview } from "./llm.ts";
import type { Mistakes } from "./mistakes.ts";

export interface TutorRequest {
  series: string;
  lessonKey: LessonKey;
  edition: string;
  /** The exercise on screen, if any. */
  exerciseKey?: string;
  message: string;
  language: string;
}

export interface ContextUsage {
  /** Estimated tokens of the request (system prompt with course context, history, message). */
  tokens: number;
  /** The model's context window, when known. */
  window: number | null;
  /** Tokens reserved for the reply. */
  reply: number;
  /** Conversation turns that still fit, of all turns so far. */
  kept: number;
  total: number;
}

export function createTutor(deps: {
  db: ProfileDb;
  content: Content;
  llm: Llm;
  mistakes: Mistakes;
  lessons: LessonContexts;
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

  /** What the tutor knows: the lesson context plus the learner's mistakes. */
  async function context(series: string, lessonKey: LessonKey, edition: string) {
    const ctx = await deps.lessons.get(series, lessonKey, edition);
    return {
      lesson: ctx.lesson,
      locale: ctx.locale,
      input: {
        target: ctx.target,
        lesson: ctx.info,
        knownVocab: ctx.knownVocab,
        earlierLessons: ctx.earlierLessons,
        mistakes: {
          lesson: await deps.lessons.mistakes(
            series,
            edition,
            deps.mistakes.list({ lesson: lessonKey, limit: 15 }),
          ),
          earlier: await deps.lessons.mistakes(
            series,
            edition,
            deps.mistakes.list({ except: lessonKey, limit: 10 }),
            ctx.titles,
          ),
        },
      } satisfies Partial<ChatTurnInput>,
    };
  }

  /** What chat_turn gets for a message: the lesson context, the exercise on screen, the history. */
  async function turnInput(request: TutorRequest, history: LlmTurnPayload[]) {
    const { lesson, locale, input } = await context(
      request.series,
      request.lessonKey,
      request.edition,
    );
    const exercise = lesson.pages.find((p) => p.exercise.key === request.exerciseKey)?.exercise;
    return {
      exercise,
      input: {
        ...input,
        language: request.language,
        exercise: exercise && { exercise, locale: locale?.exercises[exercise.key] },
        history: history.map((t) => ({ role: t.role, text: t.text })),
        message: request.message,
      } satisfies ChatTurnInput,
    };
  }

  return {
    /**
     * How full the next request would be: its size, the model's window (when known), the room kept for
     * the reply, and how many turns of the conversation still fit the history budget.
     */
    async usage(request: TutorRequest): Promise<ContextUsage> {
      const run = activeRun(request.lessonKey);
      const history = run ? turns(run.id) : [];
      const { input } = await turnInput(request, history);
      const task = chatTurnRequest(input);
      return {
        tokens: estimateTokens(task.messages.map((m) => m.content).join("")),
        window: deps.llm.contextWindow(),
        reply: task.maxTokens ?? 0,
        // system + kept history + the new message
        kept: task.messages.length - 2,
        total: history.length,
      };
    },

    /** The request a message would send now, without sending it (prompt viewer). */
    async prompt(request: TutorRequest): Promise<PromptPreview> {
      const run = activeRun(request.lessonKey);
      const { input } = await turnInput(request, run ? turns(run.id) : []);
      return deps.llm.preview(chatTurnRequest(input));
    },

    /** Turns of the lesson's current chat. */
    history(lessonKey: string): LlmTurnPayload[] {
      const run = activeRun(lessonKey);
      return run ? turns(run.id) : [];
    },

    /** Sends a message; the reply is streamed. Both turns are stored once the reply has text. */
    async send(request: TutorRequest, signal?: AbortSignal): Promise<AsyncIterable<string>> {
      const { client, model } = await deps.llm.model();
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
      const { input, exercise } = await turnInput(request, turns(run.id));
      const reply = chatTurn(client, model, input, signal);
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
