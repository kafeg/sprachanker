// The lesson tutor: one chat per lesson, stored as a `chat` run with `llm_turn` events (05, 07).
import { type ChatTurnInput, chatTurn, chatTurnRequest, estimateTokens } from "@sprachanker/llm";
import { findExercise, type LessonKey, type LlmTurnPayload } from "@sprachanker/schema";
import type { LessonContexts } from "./lesson-context.ts";
import type { Llm, PromptPreview } from "./llm.ts";
import type { LlmRuns } from "./llm-runs.ts";
import type { Mistakes } from "./mistakes.ts";
import type { TutorTools } from "./tutor-tools.ts";

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
  runs: LlmRuns;
  llm: Llm;
  mistakes: Mistakes;
  lessons: LessonContexts;
  tools: TutorTools;
}) {
  const { runs } = deps;
  const activeRun = (lessonKey: string) => runs.active("chat", lessonKey);
  const turns = (runId: string) => runs.turns(runId);

  /** What the tutor knows: the lesson context plus the learner's mistakes. */
  async function context(series: string, lessonKey: LessonKey, edition: string) {
    const ctx = await deps.lessons.get(series, lessonKey, edition);
    // One pass over the answers, split into this lesson's mistakes and the others'.
    const all = deps.mistakes.list();
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
            all.filter((m) => m.lessonKey === lessonKey).slice(0, 15),
          ),
          earlier: await deps.lessons.mistakes(
            series,
            edition,
            all.filter((m) => m.lessonKey !== lessonKey).slice(0, 10),
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
    const exercise = request.exerciseKey ? findExercise(lesson, request.exerciseKey) : undefined;
    return {
      exercise,
      input: {
        ...input,
        language: request.language,
        rules: deps.llm.rulesFor("tutor", request.language, input.target),
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
      const run = runs.activeOrStart("chat", request.lessonKey, request.edition);
      const { input, exercise } = await turnInput(request, turns(run.id));
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
        try {
          for await (const chunk of reply) {
            text += chunk;
            yield chunk;
          }
        } finally {
          // Also keeps a reply cut short by the learner; nothing is stored if the model never answered.
          if (text.trim()) {
            runs.add(run.id, "llm_turn", [
              { role: "user", text: request.message, exerciseKey: exercise?.key },
              { role: "assistant", text: text.trim(), model, ...(used.length && { tools: used }) },
            ]);
          }
        }
      })();
    },

    /** Ends the lesson's chat; the next message starts a new one. */
    reset(lessonKey: string) {
      const run = activeRun(lessonKey);
      if (run) runs.finish(run.id, "user");
    },
  };
}
export type Tutor = ReturnType<typeof createTutor>;
