// "Write it yourself" (07): the lesson's writing task, and texts checked by the model. A check is an
// `llm_verdict` event (`task: writing`) of the lesson run the lesson shows — like an explanation, a
// one-off verdict on the learner's work belongs to the run it was given in (05); the lesson's earlier
// checks are read across its runs.
import {
  checkWritingTask,
  cleanCheck,
  structuredRequest,
  type WritingInput,
  writingTopic,
} from "@sprachanker/llm";
import type { LessonKey, Run } from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import { createInFlight } from "./in-flight.ts";
import type { LessonContexts } from "./lesson-context.ts";
import type { Llm, PromptPreview } from "./llm.ts";
import { HISTORY_LIMIT, type RunStore } from "./run-store.ts";
import { keepVerdict, type Verdict, verdicts } from "./verdicts.ts";

export interface WritingRequest {
  series: string;
  lessonKey: LessonKey;
  edition: string;
  text: string;
  language: string;
}

export function createWriting(deps: {
  store: RunStore;
  /** The run the lesson shows (the runs service). */
  session: (lessonKey: LessonKey) => Promise<{ run: Run } | undefined>;
  llm: Llm;
  lessonContext: LessonContexts;
}) {
  const { store } = deps;
  /** The text being checked, per lesson. */
  const checking = createInFlight<{ text: string }>("writing_busy");

  /** Writing checks of the lesson in all its runs, newest first; one stored in a shape that no longer
   *  reads is left out. */
  const attempts = (lessonKey: LessonKey) =>
    verdicts(store, "writing", { kind: "lesson", about: lessonKey });

  async function writingInput(request: WritingRequest): Promise<WritingInput> {
    const ctx = await deps.lessonContext.get(request.series, request.lessonKey, request.edition);
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
      const ctx = await deps.lessonContext.get(series, lessonKey, edition);
      return {
        topic: writingTopic(ctx.info),
        words: ctx.info.vocab.map((v) => v.target),
        attempts: attempts(lessonKey).slice(0, HISTORY_LIMIT),
        /** A text the model is checking now (its result comes as the newest attempt). */
        checking: checking.get(lessonKey)?.text ?? null,
      };
    },

    /** Checks a text with the configured model and keeps the verdict in the lesson's run (also a
     *  finished one, as the lesson shows it). Runs to its end even when the page that asked is gone. */
    check(request: WritingRequest): Promise<Verdict<"writing">> {
      return checking.run(request.lessonKey, { text: request.text }, async () => {
        const session = await deps.session(request.lessonKey);
        if (!session) throw new ServiceError("no_lesson_run", 409);
        const task = checkWritingTask(await writingInput(request));
        const { result: check, model, latencyMs } = await deps.llm.structured(task);
        const result = cleanCheck(check, request.text);
        return keepVerdict(store, session.run.id, {
          task: "writing",
          input: request.text,
          result,
          model,
          latencyMs,
        }).verdict;
      });
    },

    async prompt(request: WritingRequest): Promise<PromptPreview> {
      return deps.llm.preview(structuredRequest(checkWritingTask(await writingInput(request))));
    },
  };
}
export type Writing = ReturnType<typeof createWriting>;
