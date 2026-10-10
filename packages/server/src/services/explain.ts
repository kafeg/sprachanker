// "Why is this wrong?" (07): the item, the answers and the lesson's grammar go to the configured model,
// whose explanation is streamed back. A finished explanation is stored in the lesson run as an
// `llm_verdict` on the item, with the attempt it explains (05), so it is shown again without asking.

import { answerAt } from "@sprachanker/engine";
import { type ExplainMistakeInput, explainMistake, explainMistakeRequest } from "@sprachanker/llm";
import { findExercise, type LessonKey } from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import type { LessonContexts } from "./lesson-context.ts";
import { type Llm, type PromptPreview, stopwatch } from "./llm.ts";
import type { RunStore } from "./run-store.ts";
import { keepVerdict, type Verdict, verdicts } from "./verdicts.ts";

export interface ExplainRequest {
  series: string;
  lessonKey: LessonKey;
  edition: string;
  exerciseKey: string;
  index: number;
  answer?: unknown;
  language: string;
  /** Where the explanation is kept: the lesson run and the attempt it explains. */
  runId?: string;
  attempt?: number;
}

export function createExplain(deps: {
  llm: Llm;
  lessons: LessonContexts;
  /** One of the lesson's runs (the runs service). */
  lessonRun: (lessonKey: LessonKey, runId: string) => { id: string } | undefined;
  store: RunStore;
  now: () => number;
}) {
  const { llm, lessons, lessonRun, store, now } = deps;

  /**
   * What explain_mistake gets for one item: the item, the answers and the lesson's grammar. An
   * explanation kept with a run explains that run's answer at that attempt, read from the run.
   */
  async function input(request: ExplainRequest) {
    if (request.runId && !lessonRun(request.lessonKey, request.runId))
      throw new ServiceError("no_such_run", 404);
    const { lesson, locale, target, info } = await lessons.get(
      request.series,
      request.lessonKey,
      request.edition,
    );
    const exercise = findExercise(lesson, request.exerciseKey);
    const item = exercise?.items[request.index];
    if (!exercise || !item) throw new ServiceError("no_such_item", 404);
    let answer = request.answer;
    if (request.runId && request.attempt) {
      const given = answerAt(
        store.eventsWhere({ types: ["answered"], runIds: [request.runId], itemKey: item.key }),
        item.key,
        request.attempt,
      );
      if (!given) throw new ServiceError("no_such_attempt", 404);
      answer = given.answer;
    }
    // Understanding of a recording is explained from its transcript, not guessed.
    const recording = [exercise.media, item.media].some(
      (m) => !!m?.audio || !!(m && "video" in m && m.video),
    );
    return {
      itemKey: item.key,
      input: {
        exercise,
        locale: locale?.exercises[exercise.key],
        index: request.index,
        answer,
        grammarHtml: info.grammarHtml,
        scriptHtml: recording ? locale?.tabs.script?.bodyHtml : undefined,
        language: request.language,
        target,
        rules: llm.rulesFor("explain", request.language, target),
      } satisfies ExplainMistakeInput,
    };
  }

  return {
    /** Explanation of a wrong answer, streamed; kept in the lesson run once the model has finished. */
    async stream(request: ExplainRequest, signal?: AbortSignal): Promise<AsyncIterable<string>> {
      const { itemKey, input: task } = await input(request);
      const run = request.runId ? lessonRun(request.lessonKey, request.runId) : undefined;
      const { client, model } = await llm.model();
      const elapsed = stopwatch(now);
      const reply = explainMistake(client, model, task, signal);
      const attempt = request.attempt;
      return (async function* () {
        let text = "";
        for await (const chunk of reply) {
          text += chunk;
          yield chunk;
        }
        // Reached only when the model finished: an explanation cut short is not kept.
        if (run && attempt && text.trim()) {
          // Kept with the lesson run, also a finished one.
          keepVerdict(
            store,
            run.id,
            {
              task: "explain",
              input: "",
              result: text.trim(),
              model,
              latencyMs: elapsed(),
              attempt,
            },
            { itemKey },
          );
        }
      })();
    },

    /** Explanations kept in a lesson run (each on its item and attempt), oldest first; the newest
     *  one of an attempt is the one shown. */
    list(lessonKey: LessonKey, runId: string): Verdict<"explain">[] {
      if (!lessonRun(lessonKey, runId)) return [];
      return verdicts(store, "explain", { runIds: [runId] })
        .filter((v) => v.itemKey && v.attempt)
        .reverse();
    },

    /** The request it would send, without sending it. */
    async prompt(request: ExplainRequest): Promise<PromptPreview> {
      return llm.preview(explainMistakeRequest((await input(request)).input));
    },
  };
}
export type Explain = ReturnType<typeof createExplain>;
