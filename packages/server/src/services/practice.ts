// LLM practice around a lesson (07): the writing task. Each check is an `llm_verdict` event in the
// lesson's `practice` run (05), so attempts stay in the learner's history.
import {
  checkWritingTask,
  cleanWritingCheck,
  runStructured,
  structuredRequest,
  WritingCheck,
  type WritingInput,
  writingTopic,
} from "@sprachanker/llm";
import type { LessonKey, LlmVerdictPayload } from "@sprachanker/schema";
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

export function createPractice(deps: {
  store: RunStore;
  llm: Llm;
  lessons: LessonContexts;
  now: () => number;
}) {
  const { store, now } = deps;

  /** Writing checks of the lesson, newest first; one stored in a shape that no longer reads is left
   *  out. */
  const attempts = (lessonKey: LessonKey): WritingAttempt[] =>
    store
      .eventsWhere({ types: ["llm_verdict"], kind: "practice", about: lessonKey })
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
    writing: {
      /** The task (the lesson's topic and words) and earlier attempts, newest first. */
      async state(series: string, lessonKey: LessonKey, edition: string) {
        const ctx = await deps.lessons.get(series, lessonKey, edition);
        return {
          topic: writingTopic(ctx.info),
          words: ctx.info.vocab.map((v) => v.target),
          attempts: attempts(lessonKey).slice(0, 20),
        };
      },

      /** Checks a text with the configured model and stores the verdict. */
      async check(request: WritingRequest, signal?: AbortSignal): Promise<WritingAttempt> {
        const task = checkWritingTask(await writingInput(request));
        const { client, model } = await deps.llm.model();
        const started = now();
        const result = cleanWritingCheck(
          await runStructured(client, model, task, signal),
          request.text,
        );
        const run = store.activeOrStart("practice", request.lessonKey, request.edition);
        const ts = store.append(run.id, [
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
        ]);
        return { ts, text: request.text, result, model };
      },

      async prompt(request: WritingRequest): Promise<PromptPreview> {
        return deps.llm.preview(structuredRequest(checkWritingTask(await writingInput(request))));
      },
    },
  };
}
export type Practice = ReturnType<typeof createPractice>;
