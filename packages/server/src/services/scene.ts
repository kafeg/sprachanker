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
import type { LessonKey, LlmTurnPayload } from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import type { LessonContexts } from "./lesson-context.ts";
import type { Llm, PromptPreview } from "./llm.ts";
import type { RunRow, RunStore } from "./run-store.ts";

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

export function createScenes(deps: { store: RunStore; llm: Llm; lessons: LessonContexts }) {
  const { store } = deps;
  const latestRun = (lessonKey: LessonKey) => store.latest("scene", lessonKey);

  /** A scene as stored; undefined when its setup no longer reads (it is left out, not an error). */
  function stateOf(run: RunRow): SceneState | undefined {
    const setup = SceneSetupSchema.safeParse(JSON.parse(run.planJson ?? "{}"));
    if (!setup.success) return undefined;
    const list = store.payloads(run.id, "llm_turn");
    const goalsMet = list.at(-1)?.goalsMet ?? [];
    return { setup: setup.data, turns: list, goalsMet, done: run.status !== "active" };
  }

  async function turnInput(request: SceneRequest, message: string) {
    const run = latestRun(request.lessonKey);
    const state = run?.status === "active" ? stateOf(run) : undefined;
    if (!run || !state) throw new ServiceError("no_active_scene", 409);
    const ctx = await deps.lessons.get(request.series, request.lessonKey, request.edition);
    const input: SceneTurnInput = {
      language: request.language,
      target: ctx.target,
      rules: deps.llm.rulesFor("scene", request.language, ctx.target),
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
    state(lessonKey: LessonKey): SceneState | null {
      const run = latestRun(lessonKey);
      return (run && stateOf(run)) ?? null;
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
      const run = store.atomic(() => {
        const previous = store.active("scene", request.lessonKey);
        if (previous) store.end(previous.id, "finished", "user");
        const started = store.start("scene", request.lessonKey, {
          edition: request.edition,
          plan: setup,
        });
        store.append(started.id, [
          {
            type: "llm_turn",
            payload: { role: "assistant", text: setup.opening, model, goalsMet: [] },
          },
        ]);
        return started;
      });
      return stateOf(run) as SceneState;
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
      // Stored only while this scene is still active (not ended or replaced during the call).
      store.atomic(() => {
        store.append(run.id, [
          {
            type: "llm_turn",
            payload: { role: "user", text: request.text, corrections: turn.corrections },
          },
          {
            type: "llm_turn",
            payload: {
              role: "assistant",
              text: turn.reply,
              translation: turn.translation,
              goalsMet: turn.goalsMet,
              model,
            },
          },
        ]);
        if (turn.done) store.end(run.id, "finished", "completed");
      });
      return stateOf(store.get(run.id) ?? run) as SceneState;
    },

    end(lessonKey: LessonKey) {
      const run = store.active("scene", lessonKey);
      if (run) store.end(run.id, "finished", "user");
    },

    async prompt(request: SceneRequest & { text: string }): Promise<PromptPreview> {
      const { input } = await turnInput(request, request.text);
      return deps.llm.preview(structuredRequest(sceneTurnTask(input)));
    },
  };
}
export type Scenes = ReturnType<typeof createScenes>;
