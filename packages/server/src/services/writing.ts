// "Write it yourself" (07): the lesson's writing task, and texts checked by the model. A check is an
// `llm_verdict` event (`task: writing`) of the lesson run the lesson shows — like an explanation, a
// one-off verdict on the learner's work belongs to the run it was given in (05); the lesson's earlier
// checks are read across its runs.
import {
  checkWritingTask,
  cleanWritingCheck,
  runStructured,
  structuredRequest,
  WritingCheck,
  type WritingInput,
  writingTopic,
} from "@sprachanker/llm";
import type { LessonKey, LlmVerdictPayload, Run } from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import type { LessonContexts } from "./lesson-context.ts";
import type { Llm, PromptPreview } from "./llm.ts";
import type { RunStore } from "./run-store.ts";

export interface WritingRequest {
  series: string;
  lessonKey: LessonKey;
  edition: string;
  text: string;
  language: string;
}

export interface WritingAttempt {
  ts: number;
  text: string;
  result: WritingCheck;
  model: string;
}

export function createWriting(deps: {
  store: RunStore;
  /** The run the lesson shows (the runs service). */
  session: (lessonKey: LessonKey) => Promise<{ run: Run } | undefined>;
  llm: Llm;
  lessons: LessonContexts;
  now: () => number;
}) {
  const { store, now } = deps;

  /** Writing checks of the lesson in all its runs, newest first; one stored in a shape that no longer
   *  reads is left out. */
  const attempts = (lessonKey: LessonKey): WritingAttempt[] =>
    store
      .eventsWhere({ types: ["llm_verdict"], kind: "lesson", about: lessonKey })
      .map((e) => ({ ts: e.ts, ...(e.payload as LlmVerdictPayload) }))
      .filter((v) => v.task === "writing")
      .flatMap((v) => {
        const result = WritingCheck.safeParse(v.result);
        return result.success
          ? [{ ts: v.ts, text: v.input, result: result.data, model: v.model }]
          : [];
      });

  async function writingInput(request: WritingRequest): Promise<WritingInput> {
    const ctx = await deps.lessons.get(request.series, request.lessonKey, request.edition);
    return {
      language: request.language,
      target: ctx.target,
      rules: deps.llm.rulesFor("writing", request.language, ctx.target),
      lesson: ctx.info,
      text: request.text,
    };
  }

  return {
    /** The task (the lesson's topic and words) and earlier attempts, newest first. */
    async state(series: string, lessonKey: LessonKey, edition: string) {
      const ctx = await deps.lessons.get(series, lessonKey, edition);
      return {
        topic: writingTopic(ctx.info),
        words: ctx.info.vocab.map((v) => v.target),
        attempts: attempts(lessonKey).slice(0, 20),
      };
    },

    /** Checks a text with the configured model and keeps the verdict in the lesson's run (also a
     *  finished one, as the lesson shows it). */
    async check(request: WritingRequest, signal?: AbortSignal): Promise<WritingAttempt> {
      const session = await deps.session(request.lessonKey);
      if (!session) throw new ServiceError("no_session", 409);
      const task = checkWritingTask(await writingInput(request));
      const { client, model } = await deps.llm.model();
      const started = now();
      const result = cleanWritingCheck(
        await runStructured(client, model, task, signal),
        request.text,
      );
      const ts = store.append(
        session.run.id,
        [
          {
            type: "llm_verdict",
            payload: {
              task: "writing",
              input: request.text,
              result,
              model,
              latencyMs: Math.max(0, now() - started),
            },
          },
        ],
        { anyStatus: true },
      );
      return { ts, text: request.text, result, model };
    },

    async prompt(request: WritingRequest): Promise<PromptPreview> {
      return deps.llm.preview(structuredRequest(checkWritingTask(await writingInput(request))));
    },
  };
}
export type Writing = ReturnType<typeof createWriting>;
