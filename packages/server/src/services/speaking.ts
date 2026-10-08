// An answer said aloud without a phrase to say (08, "Checking speech"; 07): what the recogniser heard,
// checked by the configured model against the item, its question and the source's answer — both heard
// from the course's recordings. A check is an `llm_verdict` (`task: speaking`) on the item in the lesson
// run, for what was heard: asked once per answer, shown again without asking.
import {
  checkSpeakingTask,
  cleanSpokenCheck,
  runStructured,
  type SpeakingInput,
  structuredRequest,
} from "@sprachanker/llm";
import {
  findExercise,
  type LessonKey,
  type LlmVerdictPayload,
  SpokenCheck,
  type StoredEvent,
} from "@sprachanker/schema";
import { ulid } from "ulid";
import { ServiceError } from "../errors.ts";
import type { Content } from "./content.ts";
import { createInFlight } from "./in-flight.ts";
import type { LessonContexts } from "./lesson-context.ts";
import { type Llm, type PromptPreview, stopwatch } from "./llm.ts";
import type { RunStore } from "./run-store.ts";

export interface SpeakingRequest {
  series: string;
  lessonKey: LessonKey;
  edition: string;
  exerciseKey: string;
  index: number;
  /** What the recogniser heard. */
  transcript: string;
  /** The lesson run the answer was given in: the check is kept there. */
  runId: string;
  language: string;
}

export interface StoredSpokenCheck {
  itemKey: string;
  transcript: string;
  result: SpokenCheck;
  model: string;
  ts: number;
}

export function createSpeaking(deps: {
  llm: Llm;
  content: Content;
  lessons: LessonContexts;
  /** One of the lesson's runs (the runs service). */
  lessonRun: (lessonKey: LessonKey, runId: string) => { id: string } | undefined;
  store: RunStore;
  /** What a course recording says, heard with the profile's recogniser; undefined without one. */
  hear: (series: string, path: string, lang: string) => Promise<string | undefined>;
  now: () => number;
}) {
  const { llm, content, store, now } = deps;
  /** Answers being checked, by run, item and what was heard. */
  const checking = createInFlight<true>("speaking_busy");

  const kept = (runId: string, itemKey?: string): StoredSpokenCheck[] =>
    store.verdicts("speaking", SpokenCheck, { runIds: [runId], itemKey }).flatMap((v) =>
      v.itemKey
        ? [
            {
              itemKey: v.itemKey,
              transcript: v.input,
              result: v.result,
              model: v.model,
              ts: v.ts,
            },
          ]
        : [],
    );

  async function input(request: SpeakingRequest) {
    if (!deps.lessonRun(request.lessonKey, request.runId))
      throw new ServiceError("no_such_run", 404);
    const [{ lesson, locale }, ctx] = await Promise.all([
      content.lessonWithLocale(request.series, request.lessonKey, request.edition),
      deps.lessons.get(request.series, request.lessonKey, request.edition),
    ]);
    const exercise = findExercise(lesson, request.exerciseKey);
    const item = exercise?.items[request.index];
    // Only an answer of one's own: a phrase to say is checked by the word diff (08).
    if (exercise?.type !== "speech_selfrate" || !item || ("text" in item && item.text))
      throw new ServiceError("no_such_item", 404);
    const hear = (path: string | undefined) =>
      path ? deps.hear(request.series, path, ctx.target) : Promise.resolve(undefined);
    const [question, sample] = await Promise.all([
      hear(item.media?.audio),
      hear("answerAudio" in item ? item.answerAudio : undefined),
    ]);
    return {
      itemKey: item.key,
      input: {
        language: request.language,
        target: ctx.target,
        rules: llm.rulesFor("speaking", request.language, ctx.target),
        lesson: ctx.info,
        exercise,
        locale: locale?.exercises[exercise.key],
        index: request.index,
        question,
        sample,
        transcript: request.transcript,
      } satisfies SpeakingInput,
    };
  }

  return {
    /** The model's check of an answer, kept in its lesson run (also a finished one); one kept for the
     *  same words is returned without asking again. */
    async check(
      request: SpeakingRequest,
    ): Promise<
      StoredSpokenCheck & { /** The event kept, for the player's run. */ event?: StoredEvent }
    > {
      const { itemKey, input: task } = await input(request);
      const same = kept(request.runId, itemKey).find((c) => c.transcript === request.transcript);
      if (same) return same;
      return checking.run(`${request.runId}|${itemKey}|${request.transcript}`, true, async () => {
        const { client, model } = await llm.model();
        const elapsed = stopwatch(now);
        const result = cleanSpokenCheck(
          await runStructured(client, model, checkSpeakingTask(task)),
          request.transcript,
        );
        const id = ulid();
        const payload: LlmVerdictPayload = {
          task: "speaking",
          input: request.transcript,
          result,
          model,
          latencyMs: elapsed(),
        };
        const ts = store.append(request.runId, [{ id, type: "llm_verdict", itemKey, payload }], {
          anyStatus: true,
        });
        const event = {
          id,
          runId: request.runId,
          ts,
          type: "llm_verdict" as const,
          itemKey,
          payload,
        };
        return { itemKey, transcript: request.transcript, result, model, ts, event };
      });
    },

    /** Checks kept in a lesson run, oldest first. */
    list(lessonKey: LessonKey, runId: string): StoredSpokenCheck[] {
      return deps.lessonRun(lessonKey, runId) ? kept(runId).reverse() : [];
    },

    /** The request it would send, without sending it. */
    async prompt(request: SpeakingRequest): Promise<PromptPreview> {
      return llm.preview(structuredRequest(checkSpeakingTask((await input(request)).input)));
    },
  };
}
export type Speaking = ReturnType<typeof createSpeaking>;
