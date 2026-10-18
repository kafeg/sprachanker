// An answer said aloud without a line to say: what the recogniser heard,
// checked by the configured model against the item, its question and the source's answer — both heard
// from the course's recordings (the source's answer as heard into the course, where it was: heard.ts).
// Asked by the page only: by itself where nothing can check the answer (no source's answer heard),
// else when the learner asks "Why?" (owner, 2026-10-18); the server asks nothing by itself. A check is an
// `llm_verdict` (`task: speaking`) on the item in the lesson run, for what was heard: asked once per
// answer, shown again without asking.

import { linesToSay } from "@sprachanker/engine";
import {
  checkSpeakingTask,
  cleanCheck,
  type SpeakingInput,
  structuredRequest,
} from "@sprachanker/llm";
import { findExercise, type ItemOf, type LessonKey, type TypedEvent } from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import { createInFlight } from "./in-flight.ts";
import type { LessonContexts } from "./lesson-context.ts";
import type { Llm, PromptPreview } from "./llm.ts";
import type { RunStore } from "./run-store.ts";
import { keepVerdict, type Verdict, verdicts } from "./verdicts.ts";

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

export function createSpeaking(deps: {
  llm: Llm;
  lessonContext: LessonContexts;
  /** One of the lesson's runs (the lessons service). */
  lessonRun: (lessonKey: LessonKey, runId: string) => { id: string } | undefined;
  store: RunStore;
  /** What a course recording says, heard with the profile's recogniser; undefined without one. */
  hear: (series: string, path: string, lang: string) => Promise<string | undefined>;
  /** The source's answers heard into the course (by media path): the sample is not heard again. */
  heard?: (series: string, lessonKey: LessonKey) => Promise<Record<string, string>>;
}) {
  const { llm, store } = deps;
  /** Answers being checked, by run, item and what was heard. */
  const checking = createInFlight<true>("speaking_busy");

  /** Checks kept in a run (`input`: what was heard), newest first. */
  const kept = (runId: string, itemKey?: string) =>
    verdicts(store, "speaking", { runIds: [runId], itemKey }).filter((v) => v.itemKey);

  /** The item asked about, checked: a speaking item of one's own in a run of the lesson. */
  async function itemOf(request: SpeakingRequest) {
    if (!deps.lessonRun(request.lessonKey, request.runId))
      throw new ServiceError("no_such_run", 404);
    const ctx = await deps.lessonContext.get(request.series, request.lessonKey, request.edition);
    const exercise = findExercise(ctx.lesson, request.exerciseKey);
    const item = exercise?.items[request.index];
    // Only an answer of one's own: a line to say is checked by the word diff.
    if (
      exercise?.type !== "speech_selfrate" ||
      !item ||
      linesToSay(item as ItemOf<"speech_selfrate">)
    )
      throw new ServiceError("no_such_item", 404);
    return { ctx, exercise, item };
  }

  /** What the task gets: the item, and its recordings heard (the recogniser may need starting). */
  async function input(request: SpeakingRequest, found: Awaited<ReturnType<typeof itemOf>>) {
    const { ctx, exercise, item } = found;
    const { locale } = ctx;
    const hear = (path: string | undefined) =>
      path ? deps.hear(request.series, path, ctx.target) : Promise.resolve(undefined);
    const kept = item.answerAudio
      ? (await deps.heard?.(request.series, request.lessonKey))?.[item.answerAudio]
      : undefined;
    const [question, sample] = await Promise.all([
      hear(item.media?.audio),
      kept !== undefined ? kept : hear(item.answerAudio),
    ]);
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
      Verdict<"speaking"> & { /** The event kept, for the player's run. */ event?: TypedEvent }
    > {
      const found = await itemOf(request);
      const itemKey = found.item.key;
      // A check kept for the same words is the answer, before anything is heard or asked.
      const same = kept(request.runId, itemKey).find((c) => c.input === request.transcript);
      if (same) return same;
      return checking.run(`${request.runId}|${itemKey}|${request.transcript}`, true, async () => {
        const { input: task } = await input(request, found);
        const { result: check, model, latencyMs } = await llm.structured(checkSpeakingTask(task));
        const result = cleanCheck(check, request.transcript);
        const { event, verdict } = keepVerdict(
          store,
          request.runId,
          { task: "speaking", input: request.transcript, result, model, latencyMs },
          { itemKey },
        );
        return { ...verdict, event };
      });
    },

    /** Checks kept in a lesson run, oldest first. */
    list(lessonKey: LessonKey, runId: string): Verdict<"speaking">[] {
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
