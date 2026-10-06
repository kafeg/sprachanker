// LLM practice around a lesson (07): the writing task and, later, the session review. Each check is an
// `llm_verdict` event in the lesson's `practice` run (05), so attempts stay in the learner's history.
import { exerciseResults } from "@sprachanker/engine";
import {
  checkWritingTask,
  cleanWritingCheck,
  type ReviewInput,
  reviewSessionTask,
  runStructured,
  type SessionReview,
  type StructuredTask,
  structuredRequest,
  type WritingCheck,
  type WritingInput,
  writingTopic,
} from "@sprachanker/llm";
import {
  type ExerciseKey,
  type ItemKey,
  type LessonKey,
  LlmVerdictPayload,
  parseItemKey,
  type StoredEvent,
} from "@sprachanker/schema";
import { and, desc, eq } from "drizzle-orm";
import type { ProfileDb } from "../db/profile/db.ts";
import { events, runs } from "../db/profile/schema.ts";
import type { LessonContexts } from "./lesson-context.ts";
import type { Llm, PromptPreview } from "./llm.ts";
import type { LlmRuns } from "./llm-runs.ts";
import type { Mistakes } from "./mistakes.ts";

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
  db: ProfileDb;
  /** Events of the run the lesson shows (the runs service). */
  session: (lessonKey: string) => Promise<StoredEvent[]>;
  runs: LlmRuns;
  llm: Llm;
  lessons: LessonContexts;
  mistakes: Mistakes;
  now: () => number;
}) {
  const { db, now } = deps;

  /** Verdicts of a task for the lesson, newest first. */
  function verdicts(lessonKey: string, task: LlmVerdictPayload["task"]) {
    return db
      .select({ ts: events.ts, payload: events.payloadJson })
      .from(events)
      .innerJoin(runs, eq(runs.id, events.runId))
      .where(
        and(
          eq(runs.kind, "practice"),
          eq(runs.contextKey, lessonKey),
          eq(events.type, "llm_verdict"),
        ),
      )
      .orderBy(desc(events.ts))
      .all()
      .map((e) => ({ ts: e.ts, ...LlmVerdictPayload.parse(JSON.parse(e.payload)) }))
      .filter((v) => v.task === task);
  }

  /** Stores a verdict in the lesson's practice run; returns its time. */
  const store = (lessonKey: LessonKey, edition: string, payload: LlmVerdictPayload) =>
    deps.runs.add(deps.runs.activeOrStart("practice", lessonKey, edition).id, "llm_verdict", [
      payload,
    ]);

  /** Runs a structured task with the configured model and stores the result as a verdict. */
  async function judge<T>(
    request: { lessonKey: LessonKey; edition: string },
    verdict: { task: "review" | "writing"; input: string },
    task: StructuredTask<T>,
    clean: (result: T) => T,
    signal?: AbortSignal,
  ): Promise<{ ts: number; result: T; model: string }> {
    const { client, model } = await deps.llm.model();
    const started = now();
    const result = clean(await runStructured(client, model, task, signal));
    const ts = store(request.lessonKey, request.edition, {
      ...verdict,
      result,
      model,
      latencyMs: Math.max(0, now() - started),
    });
    return { ts, result, model };
  }

  /** First attempts in the run the lesson shows (as the player reads it): item → result, and when
   *  the last answer came. */
  async function latestSession(lessonKey: string) {
    const list = await deps.session(lessonKey);
    const first = new Map<string, string>();
    for (const r of Object.values(exerciseResults(list)))
      for (const [item, outcome] of Object.entries(r.first)) first.set(item, outcome.result);
    const lastTs = Math.max(0, ...list.filter((e) => e.type === "answered").map((e) => e.ts));
    return { first, lastTs };
  }

  async function reviewInput(request: ReviewRequest): Promise<ReviewInput> {
    const ctx = await deps.lessons.get(request.series, request.lessonKey, request.edition);
    const { first } = await latestSession(request.lessonKey);
    const scored = [...first].filter(([, r]) => r !== "unscored");
    const byExercise = new Map<ExerciseKey, string[]>();
    for (const [item, result] of scored) {
      const exercise = parseItemKey(item as ItemKey).exercise;
      byExercise.set(exercise, [...(byExercise.get(exercise) ?? []), result]);
    }
    const clean = [...byExercise]
      .filter(([, results]) => results.every((r) => r === "correct"))
      .map(([key]) => ctx.locale?.exercises[key]?.title ?? key);
    return {
      language: request.language,
      target: ctx.target,
      rules: deps.llm.rulesFor("review", request.language, ctx.target),
      lesson: ctx.info,
      scored: scored.length,
      correct: scored.filter(([, r]) => r === "correct").length,
      clean,
      mistakes: await deps.lessons.mistakes(
        request.series,
        request.edition,
        deps.mistakes.list({ lesson: request.lessonKey, limit: 20 }),
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
      /** The latest review; `stale` when answers came after it; `possible` when there are answers. */
      async state(lessonKey: LessonKey) {
        const latest = verdicts(lessonKey, "review")[0];
        const { lastTs, first } = await latestSession(lessonKey);
        return {
          possible: first.size > 0,
          review: latest
            ? ({
                ts: latest.ts,
                result: latest.result as SessionReview,
                model: latest.model,
              } satisfies StoredReview)
            : null,
          stale: !!latest && lastTs > latest.ts,
        };
      },

      async create(request: ReviewRequest, signal?: AbortSignal): Promise<StoredReview> {
        const task = reviewSessionTask(await reviewInput(request));
        return judge(request, { task: "review", input: "" }, task, (r) => r, signal);
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
          attempts: verdicts(lessonKey, "writing")
            .slice(0, 10)
            .map(
              (v): WritingAttempt => ({
                ts: v.ts,
                text: v.input,
                result: v.result as WritingCheck,
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
