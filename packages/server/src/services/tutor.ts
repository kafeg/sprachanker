// The tutor's chats, `chat` runs with `llm_turn` events (05, 07), about a lesson or — the Tutor
// section's — about none. A lesson has one current chat: a new chat ends it, and it stays readable in
// the lesson's chat history until deleted. The section's chats all stay open, any of them continued.
import { exerciseResults, mistakesOf } from "@sprachanker/engine";
import {
  type ChatTurnInput,
  chatTurn,
  chatTurnRequest,
  estimateTokens,
  type SectionChatInput,
  sectionChat,
  sectionChatRequest,
  type TaskRequest,
} from "@sprachanker/llm";
import {
  findExercise,
  type LessonKey,
  type LlmTurnPayload,
  parseEditionId,
  type TypedEvent,
} from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import type { CoursesContext } from "./courses-context.ts";
import { exerciseLabel, type LessonContexts } from "./lesson-context.ts";
import { type Llm, type PromptPreview, stopwatch } from "./llm.ts";
import type { Mistakes } from "./mistakes.ts";
import { HISTORY_LIMIT, payloadOf, type RunRow, type RunStore } from "./run-store.ts";
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

/** A message in the Tutor section: to one of its chats, or (no `chatId`) opening a new one. */
export interface SectionRequest {
  chatId?: string;
  message: string;
  language: string;
}

/** A chat in a history: when, what it began with, which exercises it was about. */
interface ChatSummary {
  id: string;
  current: boolean;
  /** The pair it is held in: the language it practises. */
  edition: string | null;
  startedAt: number;
  lastAt: number;
  /** The learner's first message. */
  title: string;
  turns: number;
  /** Exercises on screen when the learner wrote, in order of first mention. */
  exerciseKeys: string[];
}

interface ContextUsage {
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
  /** The lesson run the lesson shows, with its events (the lessons service). */
  session: (lessonKey: LessonKey) => Promise<{ events: TypedEvent[] } | undefined>;
  llm: Llm;
  mistakes: Mistakes;
  lessonContext: LessonContexts;
  tools: TutorTools;
  /** What the Tutor section's chats know of the learner's courses. */
  courses: CoursesContext;
  /** Whether the tutor's place is on (Settings → AI assistant). */
  placeOn: () => boolean;
  now: () => number;
}) {
  const { store, now } = deps;
  const allowed = () => {
    if (!deps.placeOn()) throw new ServiceError("ai_place_off", 409);
  };
  const activeRun = (lessonKey: LessonKey) => store.active("chat", lessonKey);
  const turns = (runId: string) => store.payloads(runId, "llm_turn");
  /** The chat a message continues: the current one — none when the message opens a new chat, or when
   *  the lesson is shown in another edition now (a run belongs to one edition, as a lesson run does). */
  const continued = (request: TutorRequest) => {
    const run = request.newChat ? undefined : activeRun(request.lessonKey);
    return run && run.edition === request.edition ? run : undefined;
  };
  /** The turns a message continues. */
  const before = (request: TutorRequest) => {
    const run = continued(request);
    return run ? turns(run.id) : [];
  };

  /** What the tutor knows: the lesson context plus the learner's mistakes — in this lesson those of
   *  the run it shows (the ✕ in its plan), in other lessons the latest ones. */
  async function context(series: string, lessonKey: LessonKey, edition: string) {
    const ctx = await deps.lessonContext.get(series, lessonKey, edition);
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
          lesson: await deps.lessonContext.mistakes(series, edition, here.slice(0, 15)),
          earlier: await deps.lessonContext.mistakes(
            series,
            edition,
            others.slice(0, 10),
            ctx.titles,
          ),
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

  /** How full a request is: its size, the model's window (when known), the room kept for the reply,
   *  and how many of the conversation's `total` turns still fit the history budget. */
  const usageOf = (task: TaskRequest, total: number): ContextUsage => ({
    // Tool definitions go with every request, so they count too.
    tokens: estimateTokens(
      task.messages.map((m) => m.content).join("") + JSON.stringify(task.tools ?? []),
    ),
    window: deps.llm.contextWindow(),
    reply: task.maxTokens ?? 0,
    // system + kept history + the new message
    kept: task.messages.length - 2,
    total,
  });

  /** A run's chat as a history lists it; undefined while nothing was asked in it. */
  const summary = (run: RunRow, events: TypedEvent[]): ChatSummary | undefined => {
    const list = events.map((e) => payloadOf<LlmTurnPayload>(e));
    const first = list.find((t) => t.role === "user");
    if (!first) return undefined;
    return {
      id: run.id,
      current: run.status === "active",
      edition: run.edition,
      startedAt: run.startedAt,
      lastAt: list.at(-1)?.ts ?? run.startedAt,
      title: first.text.length > 120 ? `${first.text.slice(0, 119)}…` : first.text,
      turns: list.length,
      exerciseKeys: [...new Set(list.flatMap((t) => (t.exerciseKey ? [t.exerciseKey] : [])))],
    };
  };

  /** The Tutor section's chat a message continues (none: a new one) and the pair it is held in — a
   *  new chat's is the one the course studied last is in (none begun: refused). */
  async function sectionChatOf(request: SectionRequest) {
    const chat = request.chatId ? store.get(request.chatId, "chat", null) : undefined;
    if (request.chatId && !chat?.edition) throw new ServiceError("no_such_chat", 404);
    const edition = chat?.edition ?? (await deps.courses.latestEdition());
    if (!edition) throw new ServiceError("no_course_studied", 409);
    return { chat, edition };
  }

  /** What section_chat_turn gets for a message: what the learner has met, the chat's turns. */
  async function sectionInput(
    request: SectionRequest,
    edition: string,
    history: LlmTurnPayload[],
  ): Promise<SectionChatInput> {
    const target = parseEditionId(edition).target;
    return {
      language: request.language,
      target,
      rules: deps.llm.rulesFor("tutorSection", request.language, target),
      courses: await deps.courses.get(edition),
      history: history.map((t) => ({ role: t.role, text: t.text })),
      message: request.message,
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
      return usageOf(chatTurnRequest(input), history.length);
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

    /** The chats with something in them about a lesson, or the Tutor section's (`null`): a lesson's
     *  newest first, the section's by their last message. */
    chats(about: LessonKey | null, limit = HISTORY_LIMIT): ChatSummary[] {
      const runs = store.list("chat", about);
      const byRun = store.eventsOf(
        runs.map((r) => r.id),
        ["llm_turn"],
      );
      const list = runs.flatMap((run) => summary(run, byRun.get(run.id) ?? []) ?? []);
      if (about === null) list.sort((a, b) => b.lastAt - a.lastAt);
      return list.slice(0, limit);
    },

    /** The turns of one of the chats about a lesson (the section's: `null`); undefined when there is
     *  no such chat. */
    chat(about: LessonKey | null, id: string) {
      return store.get(id, "chat", about) ? turns(id) : undefined;
    },

    /** Deletes one of the chats about a lesson (the section's: `null`) with its turns (05); false
     *  when there is no such chat. */
    remove(about: LessonKey | null, id: string): boolean {
      if (!store.get(id, "chat", about)) return false;
      store.atomic(() => store.remove([id]));
      return true;
    },

    /**
     * Sends a message; the reply is streamed. Both turns are stored once the reply has text — and only
     * then does a new chat end the current one, so a failed call changes nothing.
     */
    async send(request: TutorRequest, signal?: AbortSignal): Promise<AsyncIterable<string>> {
      allowed();
      const { client, model } = await deps.llm.model();
      // The chat the reply belongs to, as the history it answers was read.
      const chat = continued(request);
      const { input, exercise } = await turnInput(request, chat ? turns(chat.id) : []);
      const elapsed = stopwatch(now);
      // The tools the model calls are recorded with its reply.
      const used: Array<{ name: string; args: unknown }> = [];
      const tool = deps.tools.runner(request.series, request.lessonKey, request.edition);
      const runTool = (name: string, args: unknown) => {
        used.push({ name, args });
        return tool(name, args);
      };
      const reply = chatTurn(client, model, input, runTool, signal);
      return keptWhenAnswered(reply, (text) =>
        // One transaction: a new chat replaces the current one only together with its turns. A reply
        // to a chat that was reset or replaced meanwhile is not kept (it answered another history).
        store.atomic(() => {
          if (chat && activeRun(request.lessonKey)?.id !== chat.id) return;
          const run =
            chat ??
            store.replace(
              "chat",
              request.lessonKey,
              { status: "finished", reason: "user" },
              { edition: request.edition },
            );
          store.append(
            run.id,
            pair(
              { text: request.message, exerciseKey: exercise?.key },
              { text, model, latencyMs: elapsed(), ...(used.length && { tools: used }) },
            ),
          );
        }),
      );
    },

    /** Ends the lesson's chat; the next message starts a new one. */
    reset(lessonKey: LessonKey) {
      const run = activeRun(lessonKey);
      if (run) store.end(run.id, "finished", "user");
    },

    /** How full the Tutor section's next request would be (as `usage`). */
    async sectionUsage(request: SectionRequest): Promise<ContextUsage> {
      const { chat, edition } = await sectionChatOf(request);
      const history = chat ? turns(chat.id) : [];
      const input = await sectionInput(request, edition, history);
      return usageOf(sectionChatRequest(input), history.length);
    },

    /** The request a message in the Tutor section would send now, without sending it. */
    async sectionPrompt(request: SectionRequest): Promise<PromptPreview> {
      const { chat, edition } = await sectionChatOf(request);
      const input = await sectionInput(request, edition, chat ? turns(chat.id) : []);
      return deps.llm.preview(sectionChatRequest(input));
    },

    /**
     * Sends a message in the Tutor section; the reply is streamed. `id` names the chat: a new one's is
     * taken now, the chat started under it only once the reply has text, with both turns — so a
     * failed call leaves nothing.
     */
    async sendSection(
      request: SectionRequest,
      signal?: AbortSignal,
    ): Promise<{ id: string; reply: AsyncIterable<string> }> {
      allowed();
      const { chat, edition } = await sectionChatOf(request);
      const { client, model } = await deps.llm.model();
      const input = await sectionInput(request, edition, chat ? turns(chat.id) : []);
      const elapsed = stopwatch(now);
      const id = chat?.id ?? store.newId();
      const reply = sectionChat(client, model, input, signal);
      return {
        id,
        reply: keptWhenAnswered(reply, (text) =>
          store.atomic(() => {
            // A chat deleted meanwhile is not started again by its reply.
            if (chat && !store.get(chat.id)) return;
            const run = chat ?? store.start("chat", null, { id, edition });
            store.append(
              run.id,
              pair({ text: request.message }, { text, model, latencyMs: elapsed() }),
            );
          }),
        ),
      };
    },
  };
}
export type Tutor = ReturnType<typeof createTutor>;

type Turn = Omit<LlmTurnPayload, "role">;

/** A question and its reply as events to store. */
const pair = (question: Turn, reply: Turn) =>
  (
    [
      { ...question, role: "user" },
      { ...reply, role: "assistant" },
    ] satisfies LlmTurnPayload[]
  ).map((payload) => ({ type: "llm_turn" as const, payload }));

/**
 * A streamed reply passed on as it comes, kept (`keep`, its text trimmed) once it is over — also one
 * the learner cut short (the stream is closed, not failed) —, never one the provider broke off, nor
 * anything when the model never answered.
 */
function keptWhenAnswered(
  reply: AsyncIterable<string>,
  keep: (text: string) => void,
): AsyncIterable<string> {
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
      if (!failed && text.trim()) keep(text.trim());
    }
  })();
}
