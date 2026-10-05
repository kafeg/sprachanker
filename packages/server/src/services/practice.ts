// LLM practice around a lesson (07): the writing task and, later, the session review. Each check is an
// `llm_verdict` event in the lesson's `practice` run (05), so attempts stay in the learner's history.
import {
  checkWritingTask,
  cleanWritingCheck,
  runStructured,
  structuredRequest,
  type WritingCheck,
  type WritingInput,
} from "@sprachanker/llm";
import { type LessonKey, LlmVerdictPayload, parseLessonKey } from "@sprachanker/schema";
import { and, desc, eq } from "drizzle-orm";
import { monotonicFactory } from "ulid";
import type { ProfileDb } from "../db/profile/db.ts";
import { events, runs } from "../db/profile/schema.ts";
import type { LessonContexts } from "./lesson-context.ts";
import type { Llm, PromptPreview } from "./llm.ts";

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
  db: ProfileDb;
  llm: Llm;
  lessons: LessonContexts;
  now: () => number;
  appVersion: string;
}) {
  const { db, now } = deps;
  const id = monotonicFactory();

  /** The lesson's practice run, created on first use. */
  function runOf(lessonKey: LessonKey, edition: string) {
    const active = db
      .select()
      .from(runs)
      .where(
        and(eq(runs.kind, "practice"), eq(runs.contextKey, lessonKey), eq(runs.status, "active")),
      )
      .get();
    return (
      active ??
      db
        .insert(runs)
        .values({
          id: id(now()),
          kind: "practice",
          contextKey: lessonKey,
          courseKey: parseLessonKey(lessonKey).course,
          edition,
          appVersion: deps.appVersion,
          status: "active",
          startedAt: now(),
        })
        .returning()
        .get()
    );
  }

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

  async function writingInput(request: WritingRequest): Promise<WritingInput> {
    const ctx = await deps.lessons.get(request.series, request.lessonKey, request.edition);
    return { language: request.language, target: ctx.target, lesson: ctx.info, text: request.text };
  }

  return {
    writing: {
      /** The task (the lesson's goals and words) and earlier attempts, newest first. */
      async state(series: string, lessonKey: LessonKey, edition: string) {
        const ctx = await deps.lessons.get(series, lessonKey, edition);
        return {
          goals: ctx.info.goals,
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
        const ts = now();
        const payload: LlmVerdictPayload = {
          task: "writing",
          input: request.text,
          result,
          model,
          latencyMs: Math.max(0, ts - started),
        };
        db.insert(events)
          .values({
            id: id(ts),
            runId: runOf(request.lessonKey, request.edition).id,
            ts,
            type: "llm_verdict",
            payloadJson: JSON.stringify(payload),
          })
          .run();
        return { ts, text: request.text, result, model };
      },

      async prompt(request: WritingRequest): Promise<PromptPreview> {
        return deps.llm.preview(structuredRequest(checkWritingTask(await writingInput(request))));
      },
    },
  };
}
export type Practice = ReturnType<typeof createPractice>;
