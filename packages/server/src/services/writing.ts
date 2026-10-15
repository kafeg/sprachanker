// Writing: the lesson's writing task — a message to answer from the text generator and a situation
// with three content points, written by the model at the course's level (`writing_task`) — and texts
// written on it, checked by the model. Each task made goes into the course's practice
// (practice.ts); the learner's step takes the next variant they have not had from there. A task
// taken and a check are `llm_verdict` events (`task: writing_task` with its `variant`, `writing`, the
// check with the task it answered) of the lesson run the lesson shows — like an explanation, a
// one-off verdict on the learner's work belongs to the run it was given in —; the lesson's tasks and
// earlier checks are read across its runs.
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
import type { Practice } from "./practice.ts";
import { HISTORY_LIMIT, type RunStore } from "./run-store.ts";
import { keptOf, type TextMaker } from "./text-maker.ts";
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
  /** The course's practice: tasks made go there, a step takes its next from there. */
  practice: Practice;
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

  /** The course's practice tasks of the lesson, the latest three. */
  const madeBefore = async (request: WritingTaskRequest) =>
    ((await deps.practice.lesson(request))?.writing ?? []).slice(-3).map((v) => v.task);

  async function taskInput(request: WritingTaskRequest): Promise<WritingTaskInput> {
    const ctx = await deps.lessonContext.get(request.series, request.lessonKey, request.edition);
    return {
      language: request.language,
      target: ctx.target,
      rules: llm.rulesFor("writingTask", request.language, ctx.target),
      lesson: ctx.info,
      areas: pickAreas(5, random),
      before: (await madeBefore(request)).map((t) => t.situation),
    };
  }

  /** The message a new task answers: drafted by the text generator in a genre one answers (not one
   *  of the latest three of the lesson's practice). */
  async function messagesFor(request: WritingTaskRequest, want: number): Promise<TaskMessage[]> {
    const input = await deps.maker.inputs(request);
    const recent = (await madeBefore(request)).flatMap((t) =>
      t.message?.genre ? [t.message.genre] : [],
    );
    const genre = pickPurposeGenre(
      "reply",
      input.ctx.info.level,
      recent,
      random,
      fewWords(input.ctx.info),
    );
    const best = await deps.maker.draft(input, genre, () => {}, "reply", want);
    return [best, ...best.more].map(({ draft }) => ({
      genre: genre.id,
      setting: draft.setting,
      lines: draftLines(draft, genre).lines,
      glossary: [],
    }));
  }

  /** Tasks written — up to `want`, on messages from one round of drafts — and added to the course's
   *  practice: how many were. */
  async function make(request: WritingTaskRequest, want = 1) {
    const r = { ...request, language: deps.practice.language(request.edition) };
    // No message the generator could stand behind: a task of the learner's own situation, as
    // before messages (a course's first lesson's few words make one hard).
    const messages: Array<TaskMessage | undefined> = await messagesFor(r, want).catch(
      (error: unknown) => {
        console.warn(`writing: no message to answer: ${(error as Error).message}`);
        return [undefined];
      },
    );
    const base = await taskInput(r);
    return keptOf(messages, async (message) => {
      const input = { ...base, ...(message && { message }) };
      const { result, model } = await llm.structured(writingTaskTask(input));
      const task = { ...writingTaskOf(result, input.lesson.level), ...(message && { message }) };
      await deps.practice.add(r, { step: "writing", variant: { model, madeAt: now(), task } });
    });
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

    /** Writes `count` tasks for the lesson into the course's practice — each a message from the text
     *  generator (a genre to answer, not the lesson's last ones), then the task of answering it (its
     *  length the level's) —, then takes the step's next the learner has not had into the run the
     *  lesson shows (the practice scripts and e2e; a lesson makes none). Runs to its end even when
     *  the page that asked is gone. */
    task(request: WritingTaskRequest, count = 1): Promise<Verdict<"writing_task">> {
      return busy.run(request.lessonKey, {}, async () => {
        await deps.practice.run(request.lessonKey);
        for (let done = 0; done < count; ) done += await make(request, count - done);
        const taken = await deps.practice.take(request, "writing");
        if (!taken) throw new ServiceError("no_such_item", 404);
        return taken;
      });
    },

    /** Writes `count` tasks for the lesson into the course's practice, nothing taken. */
    make(request: WritingTaskRequest, count = 1) {
      return busy.run(request.lessonKey, {}, async () => {
        for (let done = 0; done < count; ) done += await make(request, count - done);
      });
    },

    /** The lesson started: unless a task is being written or the latest has no text written on it
     *  yet, the step's next task of the course's practice is taken — none left: the latest stays; a
     *  failure only logged. */
    async prepare(request: WritingTaskRequest) {
      const done = () => {
        if (busy.get(request.lessonKey)) return false;
        const latest = tasks(request.lessonKey)[0];
        return !latest || attempts(request.lessonKey).some((a) => a.ts > latest.ts);
      };
      try {
        await deps.practice.take(request, "writing", done);
      } catch (error) {
        console.warn(`writing task taken as the lesson started: ${(error as Error).message}`);
      }
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
