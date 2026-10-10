// An answer said aloud without a phrase to say (08, "Checking speech"; 07): what the recogniser heard,
// checked by the configured model against the item, its question and the source's answer — both heard
// from the course's recordings. A check is an `llm_verdict` (`task: speaking`) on the item in the lesson
// run, for what was heard: asked once per answer, shown again without asking.
import {
  checkSpeakingTask,
  cleanCheck,
  type SpeakingInput,
  structuredRequest,
} from "@sprachanker/llm";
import {
  findExercise,
  type LessonKey,
  type LlmVerdictPayload,
  type SpokenCheck,
  type TypedEvent,
} from "@sprachanker/schema";
import { ulid } from "ulid";
import { ServiceError } from "../errors.ts";
import { createInFlight } from "./in-flight.ts";
import type { LessonContexts } from "./lesson-context.ts";
import type { Llm, PromptPreview } from "./llm.ts";
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
  lessons: LessonContexts;
  /** One of the lesson's runs (the runs service). */
  lessonRun: (lessonKey: LessonKey, runId: string) => { id: string } | undefined;
  store: RunStore;
  /** What a course recording says, heard with the profile's recogniser; undefined without one. */
  hear: (series: string, path: string, lang: string) => Promise<string | undefined>;
}) {
  const { llm, store } = deps;
  /** Answers being checked, by run, item and what was heard. */
  const checking = createInFlight<true>("speaking_busy");

  const kept = (runId: string, itemKey?: string): StoredSpokenCheck[] =>
    store.verdicts("speaking", { runIds: [runId], itemKey }).flatMap((v) =>
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

  /** The item asked about, checked: a speaking item of one's own in a run of the lesson. */
  async function itemOf(request: SpeakingRequest) {
    if (!deps.lessonRun(request.lessonKey, request.runId))
      throw new ServiceError("no_such_run", 404);
    const ctx = await deps.lessons.get(request.series, request.lessonKey, request.edition);
    const exercise = findExercise(ctx.lesson, request.exerciseKey);
    const item = exercise?.items[request.index];
    // Only an answer of one's own: a phrase to say is checked by the word diff (08).
    if (exercise?.type !== "speech_selfrate" || !item || ("text" in item && item.text))
      throw new ServiceError("no_such_item", 404);
    return { ctx, exercise, item };
  }

  /** What the task gets: the item, and its recordings heard (the recogniser may need starting). */
  async function input(request: SpeakingRequest, found: Awaited<ReturnType<typeof itemOf>>) {
    const { ctx, exercise, item } = found;
    const { locale } = ctx;
    const hear = (path: string | undefined) =>
      path ? deps.hear(request.series, path, ctx.target) : Promise.resolve(undefined);
    const [question, sample] = await Promise.all([hear(item.media?.audio), hear(item.answerAudio)]);
    return {
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
      StoredSpokenCheck & { /** The event kept, for the player's run. */ event?: TypedEvent }
    > {
      const found = await itemOf(request);
      const itemKey = found.item.key;
      // A check kept for the same words is the answer, before anything is heard or asked.
      const same = kept(request.runId, itemKey).find((c) => c.transcript === request.transcript);
      if (same) return same;
      return checking.run(`${request.runId}|${itemKey}|${request.transcript}`, true, async () => {
        const { input: task } = await input(request, found);
        const { result: check, model, latencyMs } = await llm.structured(checkSpeakingTask(task));
        const result = cleanCheck(check, request.transcript);
        const id = ulid();
        const payload: LlmVerdictPayload = {
          task: "speaking",
          input: request.transcript,
          result,
          model,
          latencyMs,
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
      return llm.preview(
        structuredRequest(checkSpeakingTask((await input(request, await itemOf(request))).input)),
      );
    },
  };
}
export type Speaking = ReturnType<typeof createSpeaking>;
