// The lesson tutor: one current chat per lesson, stored as a `chat` run with `llm_turn` events (05, 07).
// A new chat ends the current one, which stays readable in the lesson's chat history until deleted.
import { exerciseResults, mistakesOf } from "@sprachanker/engine";
import { type ChatTurnInput, chatTurn, chatTurnRequest, estimateTokens } from "@sprachanker/llm";
import {
  findExercise,
  type LessonKey,
  type LlmTurnPayload,
  type StoredEvent,
} from "@sprachanker/schema";
import { exerciseLabel, type LessonContexts } from "./lesson-context.ts";
import type { Llm, PromptPreview } from "./llm.ts";
import type { Mistakes } from "./mistakes.ts";
import type { RunStore } from "./run-store.ts";
import type { TutorTools } from "./tutor-tools.ts";

export interface TutorRequest {
  series: string;
  lessonKey: LessonKey;
  edition: string;
  /** The exercise on screen, if any. */
  exerciseKey?: string;
  message: string;
  language: string;
  /** End the current chat first: this message opens a new one. */
  newChat?: boolean;
}

/** A chat in the lesson's history: when, what it began with, which exercises it was about. */
export interface ChatSummary {
  id: string;
  current: boolean;
  startedAt: number;
  lastAt: number;
  /** The learner's first message. */
  title: string;
  turns: number;
  /** Exercises on screen when the learner wrote, in order of first mention. */
  exerciseKeys: string[];
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
  store: RunStore;
  /** The lesson run the lesson shows, with its events (the runs service). */
  session: (lessonKey: LessonKey) => Promise<{ events: StoredEvent[] } | undefined>;
  llm: Llm;
  mistakes: Mistakes;
  lessons: LessonContexts;
  tools: TutorTools;
}) {
  const { store } = deps;
  const activeRun = (lessonKey: LessonKey) => store.active("chat", lessonKey);
  const turns = (runId: string) => store.payloads(runId, "llm_turn");
  /** The turns a message continues: the current chat's, none when it opens a new chat. */
  const before = (request: TutorRequest) => {
    const run = request.newChat ? undefined : activeRun(request.lessonKey);
    return run ? turns(run.id) : [];
  };

  /** What the tutor knows: the lesson context plus the learner's mistakes — in this lesson those of
   *  the run it shows (the ✕ in its plan), in other lessons the latest ones. */
  async function context(series: string, lessonKey: LessonKey, edition: string) {
    const ctx = await deps.lessons.get(series, lessonKey, edition);
    const session = await deps.session(lessonKey);
    const here = session ? mistakesOf([{ events: session.events }]) : [];
    const results = exerciseResults(session?.events ?? []);
    const others = deps.mistakes.list().filter((m) => m.lessonKey !== lessonKey);
    return {
      lesson: ctx.lesson,
      locale: ctx.locale,
      results,
      input: {
        target: ctx.target,
        lesson: ctx.info,
        knownVocab: ctx.knownVocab,
        earlierLessons: ctx.earlierLessons,
        mistakes: {
          lesson: await deps.lessons.mistakes(series, edition, here.slice(0, 15)),
          earlier: await deps.lessons.mistakes(series, edition, others.slice(0, 10), ctx.titles),
        },
      } satisfies Partial<ChatTurnInput>,
    };
  }

  /** What chat_turn gets for a message: the lesson context, the exercise on screen, the history. */
  async function turnInput(request: TutorRequest, history: LlmTurnPayload[]) {
    const { lesson, locale, results, input } = await context(
      request.series,
      request.lessonKey,
      request.edition,
    );
    const exercise = request.exerciseKey ? findExercise(lesson, request.exerciseKey) : undefined;
    const label = (key: string | undefined) => key && exerciseLabel(lesson, locale, key);
    return {
      exercise,
      input: {
        ...input,
        language: request.language,
        rules: deps.llm.rulesFor("tutor", request.language, input.target),
        exercise: exercise && {
          exercise,
          locale: locale?.exercises[exercise.key],
          label: label(exercise.key) || exercise.key,
          // What the learner has answered there so far (checked answers of the run the lesson shows).
          answers: exercise.items.map((item) => {
            const last = results[exercise.key]?.last[item.key];
            return last?.outcome && { answer: last.answer, result: last.outcome.result };
          }),
        },
        // The learner's turns say which exercise was on screen (none: not on an exercise).
        history: history.map((t) =>
          t.role === "user"
            ? { role: t.role, text: t.text, exercise: label(t.exerciseKey) || null }
            : { role: t.role, text: t.text },
        ),
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
      const history = before(request);
      const { input } = await turnInput(request, history);
      const task = chatTurnRequest(input);
      return {
        // Tool definitions go with every request, so they count too.
        tokens: estimateTokens(
          task.messages.map((m) => m.content).join("") + JSON.stringify(task.tools ?? []),
        ),
        window: deps.llm.contextWindow(),
        reply: task.maxTokens ?? 0,
        // system + kept history + the new message
        kept: task.messages.length - 2,
        total: history.length,
      };
    },

    /** The request a message would send now, without sending it (prompt viewer). */
    async prompt(request: TutorRequest): Promise<PromptPreview> {
      const { input } = await turnInput(request, before(request));
      return deps.llm.preview(chatTurnRequest(input));
    },

    /** Turns of the lesson's current chat. */
    history(lessonKey: LessonKey): Array<LlmTurnPayload & { ts: number }> {
      const run = activeRun(lessonKey);
      return run ? turns(run.id) : [];
    },

    /** The lesson's chats with something in them, newest first. */
    chats(lessonKey: LessonKey): ChatSummary[] {
      return store.list("chat", lessonKey).flatMap((run) => {
        const list = turns(run.id);
        const first = list.find((t) => t.role === "user");
        if (!first) return [];
        return [
          {
            id: run.id,
            current: run.status === "active",
            startedAt: run.startedAt,
            lastAt: list.at(-1)?.ts ?? run.startedAt,
            title: first.text.length > 120 ? `${first.text.slice(0, 119)}…` : first.text,
            turns: list.length,
            exerciseKeys: [...new Set(list.flatMap((t) => (t.exerciseKey ? [t.exerciseKey] : [])))],
          },
        ];
      });
    },

    /** The turns of one of the lesson's chats; undefined when it has no such chat. */
    chat(lessonKey: LessonKey, id: string) {
      return store.get(id, "chat", lessonKey) ? turns(id) : undefined;
    },

    /** Deletes one of the lesson's chats with its turns (05); false when it has no such chat. */
    remove(lessonKey: LessonKey, id: string): boolean {
      if (!store.get(id, "chat", lessonKey)) return false;
      store.remove([id]);
      return true;
    },

    /**
     * Sends a message; the reply is streamed. Both turns are stored once the reply has text — and only
     * then does a new chat end the current one, so a failed call changes nothing.
     */
    async send(request: TutorRequest, signal?: AbortSignal): Promise<AsyncIterable<string>> {
      const { client, model } = await deps.llm.model();
      const { input, exercise } = await turnInput(request, before(request));
      // The tools the model calls are recorded with its reply.
      const used: Array<{ name: string; args: unknown }> = [];
      const tool = deps.tools.runner(request.series, request.lessonKey, request.edition);
      const runTool = (name: string, args: unknown) => {
        used.push({ name, args });
        return tool(name, args);
      };
      const reply = chatTurn(client, model, input, runTool, signal);
      return (async function* () {
        let text = "";
        let failed = false;
        try {
          for await (const chunk of reply) {
            text += chunk;
            yield chunk;
          }
        } catch (error) {
          failed = true;
          throw error;
        } finally {
          // Also keeps a reply the learner cut short (the stream is closed, not failed); a reply the
          // provider broke off is not kept, nor anything when the model never answered.
          if (!failed && text.trim()) {
            // One transaction: the new chat replaces the current one only together with its turns.
            store.atomic(() => {
              const current = activeRun(request.lessonKey);
              if (request.newChat && current) store.end(current.id, "finished", "user");
              const run =
                (!request.newChat && current) ||
                store.start("chat", request.lessonKey, { edition: request.edition });
              store.append(
                run.id,
                (
                  [
                    { role: "user", text: request.message, exerciseKey: exercise?.key },
                    {
                      role: "assistant",
                      text: text.trim(),
                      model,
                      ...(used.length && { tools: used }),
                    },
                  ] satisfies LlmTurnPayload[]
                ).map((payload) => ({ type: "llm_turn", payload })),
              );
            });
          }
        }
      })();
    },

    /** Ends the lesson's chat; the next message starts a new one. */
    reset(lessonKey: LessonKey) {
      const run = activeRun(lessonKey);
      if (run) store.end(run.id, "finished", "user");
    },
  };
}
export type Tutor = ReturnType<typeof createTutor>;
