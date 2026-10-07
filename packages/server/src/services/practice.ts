// LLM practice around a lesson (07): the writing task and the session review. Each check is an
// `llm_verdict` event in the lesson's `practice` run (05), so attempts stay in the learner's history; a
// review names the lesson run it reviews and is shown with that run.
import { exerciseResults, exerciseState, mistakesOf } from "@sprachanker/engine";
import {
  checkWritingTask,
  cleanWritingCheck,
  type ReviewInput,
  reviewSessionTask,
  runStructured,
  type SessionExerciseState,
  SessionReview,
  type StructuredTask,
  structuredRequest,
  WritingCheck,
  type WritingInput,
  writingTopic,
} from "@sprachanker/llm";
import type { LessonKey, LlmVerdictPayload, Run, StoredEvent } from "@sprachanker/schema";
import type { z } from "zod";
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

export interface ReviewRequest {
  series: string;
  lessonKey: LessonKey;
  edition: string;
  language: string;
}

export interface StoredReview {
  ts: number;
  result: SessionReview;
  model: string;
}

export interface WritingAttempt {
  ts: number;
  text: string;
  result: WritingCheck;
  model: string;
}

export function createPractice(deps: {
  /** The run the lesson shows, with its events (the runs service). */
  session: (lessonKey: LessonKey) => Promise<{ run: Run; events: StoredEvent[] } | undefined>;
  store: RunStore;
  llm: Llm;
  lessons: LessonContexts;
  now: () => number;
}) {
  const { store, now } = deps;

  /**
   * Verdicts of a task for the lesson, newest first, their result read with the task's schema: one
   * stored in a shape that no longer reads is left out.
   */
  function verdicts<T>(lessonKey: LessonKey, task: "review" | "writing", schema: z.ZodType<T>) {
    return store
      .eventsWhere({ types: ["llm_verdict"], kind: "practice", about: lessonKey })
      .map((e) => ({ ts: e.ts, ...(e.payload as LlmVerdictPayload) }))
      .filter((v) => v.task === task)
      .flatMap((v) => {
        const result = schema.safeParse(v.result);
        return result.success ? [{ ...v, result: result.data }] : [];
      });
  }

  /** Stores a verdict in the lesson's practice run; returns its time. */
  const keep = (lessonKey: LessonKey, edition: string, payload: LlmVerdictPayload) =>
    store.append(store.activeOrStart("practice", lessonKey, edition).id, [
      { type: "llm_verdict", payload },
    ]);

  /** Runs a structured task with the configured model and stores the result as a verdict. */
  async function judge<T>(
    request: { lessonKey: LessonKey; edition: string },
    verdict: { task: "review" | "writing"; input: string; runId?: string },
    task: StructuredTask<T>,
    clean: (result: T) => T,
    signal?: AbortSignal,
  ): Promise<{ ts: number; result: T; model: string }> {
    const { client, model } = await deps.llm.model();
    const started = now();
    const result = clean(await runStructured(client, model, task, signal));
    const ts = keep(request.lessonKey, request.edition, {
      ...verdict,
      result,
      model,
      latencyMs: Math.max(0, now() - started),
    });
    return { ts, result, model };
  }

  /** The lesson run each review is about: the one it names; a review stored before reviews named
   *  their run belongs to the latest lesson run started before it. */
  function reviewedRuns(lessonKey: LessonKey, reviews: Array<{ ts: number; runId?: string }>) {
    const lessonRuns = store.list("lesson", lessonKey);
    return reviews.map((r) => r.runId ?? lessonRuns.find((run) => run.startedAt <= r.ts)?.id);
  }

  /** The session read by the engine: results per exercise, first attempts (item → result), and
   *  when the last answer came. */
  function firstAttempts(list: StoredEvent[]) {
    const results = exerciseResults(list);
    const first = new Map<string, string>();
    for (const r of Object.values(results))
      for (const [item, outcome] of Object.entries(r.first)) first.set(item, outcome.result);
    const lastTs = Math.max(0, ...list.filter((e) => e.type === "answered").map((e) => e.ts));
    return { results, first, lastTs };
  }

  const STATE: Record<string, SessionExerciseState> = {
    correct: "correct",
    wrong: "mistakes",
    done: "done",
    skipped: "skipped",
  };

  async function reviewInput(request: ReviewRequest): Promise<ReviewInput> {
    const ctx = await deps.lessons.get(request.series, request.lessonKey, request.edition);
    const events = (await deps.session(request.lessonKey))?.events ?? [];
    const { results, first } = firstAttempts(events);
    const scored = [...first].filter(([, r]) => r !== "unscored");
    return {
      language: request.language,
      target: ctx.target,
      rules: deps.llm.rulesFor("review", request.language, ctx.target),
      lesson: ctx.info,
      exercises: ctx.lesson.pages.map(({ exercise }, i) => {
        const r = results[exercise.key];
        const state = exerciseState(exercise, r);
        // Wrong without a wrong answer: scored items were skipped (the engine scores them 0).
        const answeredWrong = Object.values(r?.first ?? {}).some(
          (o) => o.result === "wrong" || o.result === "partial",
        );
        return {
          // The list is numbered: the title alone (exerciseLabel would number it twice).
          title: ctx.locale?.exercises[exercise.key]?.title ?? `Exercise ${i + 1}`,
          state:
            state === "wrong" && !answeredWrong ? "skipped" : (STATE[state ?? ""] ?? "not_started"),
        };
      }),
      scored: scored.length,
      correct: scored.filter(([, r]) => r === "correct").length,
      mistakes: await deps.lessons.mistakes(
        request.series,
        request.edition,
        mistakesOf([{ events }]).slice(0, 20),
      ),
    };
  }

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
    review: {
      /** The latest review of the run the lesson shows; `stale` when answers came after it;
       *  `possible` when the run has answers. */
      async state(lessonKey: LessonKey) {
        const session = await deps.session(lessonKey);
        const reviews = verdicts(lessonKey, "review", SessionReview);
        const reviewed = reviewedRuns(lessonKey, reviews);
        const latest = session && reviews.find((_, i) => reviewed[i] === session.run.id);
        const { lastTs, first } = firstAttempts(session?.events ?? []);
        return {
          possible: first.size > 0,
          review: latest
            ? ({
                ts: latest.ts,
                result: latest.result,
                model: latest.model,
              } satisfies StoredReview)
            : null,
          // Newer answers, or a review from before reviews named their run (made by the earlier, less
          // honest rules): offered again.
          stale: !!latest && (lastTs > latest.ts || !latest.runId),
        };
      },

      async create(request: ReviewRequest, signal?: AbortSignal): Promise<StoredReview> {
        const session = await deps.session(request.lessonKey);
        if (!session) throw new ServiceError("no_session", 409);
        const task = reviewSessionTask(await reviewInput(request));
        const verdict = { task: "review" as const, input: "", runId: session.run.id };
        return judge(request, verdict, task, (r) => r, signal);
      },

      async prompt(request: ReviewRequest): Promise<PromptPreview> {
        return deps.llm.preview(structuredRequest(reviewSessionTask(await reviewInput(request))));
      },
    },

    writing: {
      /** The task (the lesson's topic and words) and earlier attempts, newest first. */
      async state(series: string, lessonKey: LessonKey, edition: string) {
        const ctx = await deps.lessons.get(series, lessonKey, edition);
        return {
          topic: writingTopic(ctx.info),
          words: ctx.info.vocab.map((v) => v.target),
          attempts: verdicts(lessonKey, "writing", WritingCheck)
            .slice(0, 10)
            .map(
              (v): WritingAttempt => ({
                ts: v.ts,
                text: v.input,
                result: v.result,
                model: v.model,
              }),
            ),
        };
      },

      /** Checks a text with the configured model and stores the verdict. */
      async check(request: WritingRequest, signal?: AbortSignal): Promise<WritingAttempt> {
        const task = checkWritingTask(await writingInput(request));
        const verdict = { task: "writing" as const, input: request.text };
        const clean = (r: WritingCheck) => cleanWritingCheck(r, request.text);
        return { ...(await judge(request, verdict, task, clean, signal)), text: request.text };
      },

      async prompt(request: WritingRequest): Promise<PromptPreview> {
        return deps.llm.preview(structuredRequest(checkWritingTask(await writingInput(request))));
      },
    },
  };
}
export type Practice = ReturnType<typeof createPractice>;
