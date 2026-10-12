// "Write it yourself" (04, "AI practice in courses"; 07): the lesson's writing task — a situation with
// three content points, written by the model at the course's level (`writing_task`) — and texts
// written on it, checked by the model. A task and a check are `llm_verdict` events (`task:
// writing_task`, `writing`, the check with the task it answered) of the lesson run the lesson shows —
// like an explanation, a one-off verdict on the learner's work belongs to the run it was given in
// (05); the lesson's tasks and earlier checks are read across its runs.
import {
  checkWritingTask,
  cleanWritingCheck,
  pickAreas,
  structuredRequest,
  type WritingInput,
  type WritingTaskInput,
  writingTaskOf,
  writingTaskTask,
} from "@sprachanker/llm";
import type { LessonKey, Run } from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import { createInFlight } from "./in-flight.ts";
import type { LessonContexts } from "./lesson-context.ts";
import type { Llm, PromptPreview } from "./llm.ts";
import { HISTORY_LIMIT, type RunStore } from "./run-store.ts";
import { keepVerdict, type Verdict, verdicts } from "./verdicts.ts";

export interface WritingTaskRequest {
  series: string;
  lessonKey: LessonKey;
  edition: string;
  language: string;
}

export interface WritingRequest extends WritingTaskRequest {
  /** The task written on (its verdict's id). */
  taskId: string;
  text: string;
}

export function createWriting(deps: {
  store: RunStore;
  /** The run the lesson shows (the lessons service). */
  session: (lessonKey: LessonKey) => Promise<{ run: Run } | undefined>;
  llm: Llm;
  lessonContext: LessonContexts;
  random?: () => number;
}) {
  const { store, llm } = deps;
  const random = deps.random ?? Math.random;
  /** What the model does for a lesson now: a text checked (`text`), or a task written. */
  const busy = createInFlight<{ text?: string }>("writing_busy");

  const where = (lessonKey: LessonKey) => ({ kind: "lesson" as const, about: lessonKey });
  /** Writing checks of the lesson in all its runs, newest first; one stored in a shape that no longer
   *  reads is left out. */
  const attempts = (lessonKey: LessonKey) => verdicts(store, "writing", where(lessonKey));
  /** The lesson's tasks in all its runs, newest first. */
  const tasks = (lessonKey: LessonKey) => verdicts(store, "writing_task", where(lessonKey));

  async function session(lessonKey: LessonKey) {
    const shown = await deps.session(lessonKey);
    if (!shown) throw new ServiceError("no_lesson_run", 409);
    return shown.run;
  }

  async function taskInput(request: WritingTaskRequest): Promise<WritingTaskInput> {
    const ctx = await deps.lessonContext.get(request.series, request.lessonKey, request.edition);
    return {
      language: request.language,
      target: ctx.target,
      rules: llm.rulesFor("writingTask", request.language, ctx.target),
      lesson: ctx.info,
      areas: pickAreas(5, random),
      before: tasks(request.lessonKey)
        .slice(0, 3)
        .map((t) => t.result.situation),
    };
  }

  async function writingInput(request: WritingRequest): Promise<WritingInput> {
    const task = tasks(request.lessonKey).find((t) => t.id === request.taskId);
    if (!task) throw new ServiceError("no_such_item", 404);
    const ctx = await deps.lessonContext.get(request.series, request.lessonKey, request.edition);
    return {
      language: request.language,
      target: ctx.target,
      rules: llm.rulesFor("writing", request.language, ctx.target),
      lesson: ctx.info,
      task: task.result,
      text: request.text,
    };
  }

  return {
    /** The lesson's latest task, the words to use, earlier attempts (newest first), and what the
     *  model is doing for the lesson now. */
    async state(series: string, lessonKey: LessonKey, edition: string) {
      const ctx = await deps.lessonContext.get(series, lessonKey, edition);
      const now = busy.get(lessonKey);
      return {
        task: tasks(lessonKey)[0] ?? null,
        words: ctx.info.vocab.map((v) => v.target),
        attempts: attempts(lessonKey).slice(0, HISTORY_LIMIT),
        /** A text the model is checking now (its result comes as the newest attempt). */
        checking: now?.text ?? null,
        /** A task being written now (it comes as the task). */
        preparing: !!now && now.text === undefined,
      };
    },

    /** Writes a new task for the lesson (its length the level's) and keeps it in the run the lesson
     *  shows. Runs to its end even when the page that asked is gone. */
    task(request: WritingTaskRequest): Promise<Verdict<"writing_task">> {
      return busy.run(request.lessonKey, {}, async () => {
        const run = await session(request.lessonKey);
        const input = await taskInput(request);
        const { result, model, latencyMs } = await llm.structured(writingTaskTask(input));
        return keepVerdict(store, run.id, {
          task: "writing_task",
          input: "",
          result: writingTaskOf(result, input.lesson.level),
          model,
          latencyMs,
        }).verdict;
      });
    },

    /** Checks a text written on a task with the configured model and keeps the verdict, with the
     *  task, in the lesson's run (also a finished one, as the lesson shows it). Runs to its end even
     *  when the page that asked is gone. */
    check(request: WritingRequest): Promise<Verdict<"writing">> {
      return busy.run(request.lessonKey, { text: request.text }, async () => {
        const run = await session(request.lessonKey);
        const input = await writingInput(request);
        const { result, model, latencyMs } = await llm.structured(checkWritingTask(input));
        return keepVerdict(store, run.id, {
          task: "writing",
          input: request.text,
          result: cleanWritingCheck(result, request.text),
          writingTask: input.task,
          model,
          latencyMs,
        }).verdict;
      });
    },

    /** The request a check would send (a text on the task given), or without a task the request that
     *  writes one. */
    async prompt(
      request: WritingTaskRequest & { taskId?: string; text: string },
    ): Promise<PromptPreview> {
      const { taskId, text } = request;
      if (!taskId) return llm.preview(structuredRequest(writingTaskTask(await taskInput(request))));
      const input = await writingInput({ ...request, taskId, text: text || "…" });
      return llm.preview(structuredRequest(checkWritingTask(input)));
    },
  };
}
export type Writing = ReturnType<typeof createWriting>;
