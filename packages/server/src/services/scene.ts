// Scenes (07): a role-play on the lesson's topic, one `scene` run each — the setup in the run's plan,
// the lines as `llm_turn` events. A scene ends when its goals are reached or the learner ends it.
import {
  cleanSceneTurn,
  runStructured,
  type SceneSetup,
  SceneSetup as SceneSetupSchema,
  type SceneTurnInput,
  sceneSetupTask,
  sceneTurnTask,
  structuredRequest,
} from "@sprachanker/llm";
import { type LessonKey, LlmTurnPayload, parseLessonKey } from "@sprachanker/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { monotonicFactory } from "ulid";
import type { ProfileDb } from "../db/profile/db.ts";
import { events, runs } from "../db/profile/schema.ts";
import type { LessonContexts } from "./lesson-context.ts";
import { type Llm, LlmSetupError, type PromptPreview } from "./llm.ts";

export interface SceneRequest {
  series: string;
  lessonKey: LessonKey;
  edition: string;
  language: string;
}

export interface SceneState {
  setup: SceneSetup;
  turns: LlmTurnPayload[];
  goalsMet: number[];
  done: boolean;
}

export function createScenes(deps: {
  db: ProfileDb;
  llm: Llm;
  lessons: LessonContexts;
  now: () => number;
  appVersion: string;
}) {
  const { db, now } = deps;
  const id = monotonicFactory();

  const latestRun = (lessonKey: string) =>
    db
      .select()
      .from(runs)
      .where(and(eq(runs.kind, "scene"), eq(runs.contextKey, lessonKey)))
      .orderBy(desc(runs.startedAt))
      .get();

  const turns = (runId: string) =>
    db
      .select()
      .from(events)
      .where(and(eq(events.runId, runId), eq(events.type, "llm_turn")))
      .orderBy(asc(events.ts), asc(events.id))
      .all()
      .map((e) => LlmTurnPayload.parse(JSON.parse(e.payloadJson)));

  function addTurns(runId: string, list: LlmTurnPayload[]) {
    db.transaction((tx) => {
      for (const payload of list) {
        const ts = now();
        tx.insert(events)
          .values({ id: id(ts), runId, ts, type: "llm_turn", payloadJson: JSON.stringify(payload) })
          .run();
      }
    });
  }

  function stateOf(run: { id: string; planJson: string | null; status: string }): SceneState {
    const setup = SceneSetupSchema.parse(JSON.parse(run.planJson ?? "{}"));
    const list = turns(run.id);
    const goalsMet = list.at(-1)?.goalsMet ?? [];
    return { setup, turns: list, goalsMet, done: run.status !== "active" };
  }

  const finish = (runId: string, endReason: "completed" | "user") =>
    db
      .update(runs)
      .set({ status: "finished", endReason, finishedAt: now() })
      .where(eq(runs.id, runId))
      .run();

  async function turnInput(request: SceneRequest, message: string) {
    const run = latestRun(request.lessonKey);
    if (!run || run.status !== "active") throw new LlmSetupError("no_active_scene");
    const ctx = await deps.lessons.get(request.series, request.lessonKey, request.edition);
    const state = stateOf(run);
    const input: SceneTurnInput = {
      language: request.language,
      target: ctx.target,
      lesson: ctx.info,
      knownVocab: ctx.knownVocab,
      setup: state.setup,
      history: state.turns.map((t) => ({ role: t.role, text: t.text })),
      message,
    };
    return { run, state, input };
  }

  return {
    /** The lesson's latest scene (active or finished), or null. */
    state(lessonKey: string): SceneState | null {
      const run = latestRun(lessonKey);
      return run ? stateOf(run) : null;
    },

    /** Drafts a new scene from the lesson (ending an unfinished one). */
    async start(request: SceneRequest, signal?: AbortSignal): Promise<SceneState> {
      const { client, model } = await deps.llm.model();
      const ctx = await deps.lessons.get(request.series, request.lessonKey, request.edition);
      const setup = await runStructured(
        client,
        model,
        sceneSetupTask({
          language: request.language,
          target: ctx.target,
          lesson: ctx.info,
          knownVocab: ctx.knownVocab,
        }),
        signal,
      );
      const previous = latestRun(request.lessonKey);
      if (previous?.status === "active") finish(previous.id, "user");
      const run = db
        .insert(runs)
        .values({
          id: id(now()),
          kind: "scene",
          contextKey: request.lessonKey,
          courseKey: parseLessonKey(request.lessonKey).course,
          edition: request.edition,
          appVersion: deps.appVersion,
          planJson: JSON.stringify(setup),
          status: "active",
          startedAt: now(),
        })
        .returning()
        .get();
      addTurns(run.id, [{ role: "assistant", text: setup.opening, model, goalsMet: [] }]);
      return stateOf(run);
    },

    /** The learner's line: the partner answers, corrects and tracks the goals. */
    async turn(request: SceneRequest & { text: string }, signal?: AbortSignal) {
      const { client, model } = await deps.llm.model();
      const { run, state, input } = await turnInput(request, request.text);
      const turn = cleanSceneTurn(
        await runStructured(client, model, sceneTurnTask(input), signal),
        request.text,
        state.setup.goals.length,
        state.goalsMet,
      );
      addTurns(run.id, [
        { role: "user", text: request.text, corrections: turn.corrections },
        {
          role: "assistant",
          text: turn.reply,
          translation: turn.translation,
          goalsMet: turn.goalsMet,
          model,
        },
      ]);
      if (turn.done) finish(run.id, "completed");
      return stateOf(latestRun(request.lessonKey) ?? run);
    },

    end(lessonKey: string) {
      const run = latestRun(lessonKey);
      if (run?.status === "active") finish(run.id, "user");
    },

    async prompt(request: SceneRequest & { text: string }): Promise<PromptPreview> {
      const { input } = await turnInput(request, request.text);
      return deps.llm.preview(structuredRequest(sceneTurnTask(input)));
    },
  };
}
export type Scenes = ReturnType<typeof createScenes>;
