// "Write it yourself" (04, "AI practice in courses"; 07): the lesson's writing task — a situation with
// three content points, written by the model at the course's level (`writing_task`) — and texts
// written on it, checked by the model. A task and a check are `llm_verdict` events (`task:
// writing_task`, `writing`, the check with the task it answered) of the lesson run the lesson shows —
// like an explanation, a one-off verdict on the learner's work belongs to the run it was given in
// (05); the lesson's tasks and earlier checks are read across its runs.
import {
  checkWritingTask,
  cleanWritingCheck,
  draftLines,
  fewWords,
  pickAreas,
  pickPurposeGenre,
  structuredRequest,
  type WritingInput,
  type WritingTaskInput,
  writingTaskOf,
  writingTaskTask,
} from "@sprachanker/llm";
import type { LessonKey, Run, TaskMessage } from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import { createInFlight } from "./in-flight.ts";
import type { LessonContexts } from "./lesson-context.ts";
import type { Llm, PromptPreview } from "./llm.ts";
import { HISTORY_LIMIT, type RunStore } from "./run-store.ts";
import type { TextMaker } from "./text-maker.ts";
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
  /** The text generator: the message a task answers. */
  maker: TextMaker;
  random?: () => number;
  now?: () => number;
}) {
  const { store, llm } = deps;
  const random = deps.random ?? Math.random;
  const now = deps.now ?? Date.now;
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

  /** The message a new task answers: drafted by the text generator in a genre one answers. */
  async function messageFor(request: WritingTaskRequest): Promise<TaskMessage> {
    const input = await deps.maker.inputs(request);
    const recent = tasks(request.lessonKey)
      .slice(0, 3)
      .flatMap((t) => (t.result.message?.genre ? [t.result.message.genre] : []));
    const genre = pickPurposeGenre(
      "reply",
      input.ctx.info.level,
      recent,
      random,
      fewWords(input.ctx.info),
    );
    const { draft } = await deps.maker.draft(input, genre, () => {}, "reply");
    return {
      genre: genre.id,
      setting: draft.setting,
      lines: draftLines(draft, genre).lines,
      glossary: [],
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

    /** Writes a new task for the lesson and keeps it in the run the lesson shows: a message from the
     *  text generator (a genre to answer, not the lesson's last ones), then the task of answering it
     *  (its length the level's). Runs to its end even when the page that asked is gone. */
    task(request: WritingTaskRequest): Promise<Verdict<"writing_task">> {
      return busy.run(request.lessonKey, {}, async () => {
        const run = await session(request.lessonKey);
        const started = now();
        // No message the generator could stand behind: a task of the learner's own situation, as
        // before messages (a course's first lesson's few words make one hard).
        const message = await messageFor(request).catch((error: unknown) => {
          console.warn(`writing: no message to answer: ${(error as Error).message}`);
          return undefined;
        });
        const input = { ...(await taskInput(request)), ...(message && { message }) };
        const { result, model } = await llm.structured(writingTaskTask(input));
        return keepVerdict(store, run.id, {
          task: "writing_task",
          input: "",
          result: { ...writingTaskOf(result, input.lesson.level), ...(message && { message }) },
          model,
          latencyMs: Math.max(0, Math.round(now() - started)),
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
      if (!taskId) {
        // The message the latest task answered stands for the one the text generator writes anew.
        const message = tasks(request.lessonKey)[0]?.result.message;
        const input = { ...(await taskInput(request)), ...(message && { message }) };
        return llm.preview(structuredRequest(writingTaskTask(input)));
      }
      const input = await writingInput({ ...request, taskId, text: text || "…" });
      return llm.preview(structuredRequest(checkWritingTask(input)));
    },
  };
}
export type Writing = ReturnType<typeof createWriting>;
