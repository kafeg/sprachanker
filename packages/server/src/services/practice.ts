// LLM practice around a lesson (07): the writing task and, later, the session review. Each check is an
// `llm_verdict` event in the lesson's `practice` run (05), so attempts stay in the learner's history.
import {
  checkWritingTask,
  cleanWritingCheck,
  type ReviewInput,
  reviewSessionTask,
  runStructured,
  type SessionReview,
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

  /** First attempts of the lesson's latest run: item → result, and when the last answer came. */
  function latestSession(lessonKey: string) {
    const run = db
      .select()
      .from(runs)
      .where(and(eq(runs.kind, "lesson"), eq(runs.contextKey, lessonKey)))
      .orderBy(desc(runs.startedAt))
      .get();
    const first = new Map<string, string>();
    let lastTs = 0;
    if (run) {
      for (const e of db
        .select()
        .from(events)
        .where(and(eq(events.runId, run.id), eq(events.type, "answered")))
        .all()) {
        lastTs = Math.max(lastTs, e.ts);
        const p = JSON.parse(e.payloadJson) as { attempt: number; outcome: { result: string } };
        if (p.attempt === 1 && e.itemKey) first.set(e.itemKey, p.outcome.result);
      }
    }
    return { first, lastTs };
  }

  async function reviewInput(request: ReviewRequest): Promise<ReviewInput> {
    const ctx = await deps.lessons.get(request.series, request.lessonKey, request.edition);
    const { first } = latestSession(request.lessonKey);
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
    return { language: request.language, target: ctx.target, lesson: ctx.info, text: request.text };
  }

  return {
    review: {
      /** The latest review; `stale` when answers came after it; `possible` when there are answers. */
      state(lessonKey: LessonKey) {
        const latest = verdicts(lessonKey, "review")[0];
        const { lastTs, first } = latestSession(lessonKey);
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
        const { client, model } = await deps.llm.model();
        const input = await reviewInput(request);
        const started = now();
        const result = await runStructured(client, model, reviewSessionTask(input), signal);
        const ts = store(request.lessonKey, request.edition, {
          task: "review",
          input: "",
          result,
          model,
          latencyMs: Math.max(0, now() - started),
        });
        return { ts, result, model };
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
        const { client, model } = await deps.llm.model();
        const input = await writingInput(request);
        const started = now();
        const result = cleanWritingCheck(
          await runStructured(client, model, checkWritingTask(input), signal),
          request.text,
        );
        const ts = store(request.lessonKey, request.edition, {
          task: "writing",
          input: request.text,
          result,
          model,
          latencyMs: Math.max(0, now() - started),
        });
        return { ts, text: request.text, result, model };
      },

      async prompt(request: WritingRequest): Promise<PromptPreview> {
        return deps.llm.preview(structuredRequest(checkWritingTask(await writingInput(request))));
      },
    },
  };
}
export type Practice = ReturnType<typeof createPractice>;
