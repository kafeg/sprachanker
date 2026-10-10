// Scenes (07): a role-play on the lesson's topic, one `scene` run each — the setup in the run's plan,
// the lines as `llm_turn` events. A scene ends when its goals are reached or a new one is started; the
// lesson's scenes stay readable, newest first.
import {
  cleanSceneTurn,
  type SceneTurnInput,
  sceneSetupTask,
  sceneTurnTask,
  structuredRequest,
} from "@sprachanker/llm";
import { type LessonKey, type LlmTurnPayload, SceneSetup } from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import { createInFlight } from "./in-flight.ts";
import type { LessonContexts } from "./lesson-context.ts";
import type { Llm, PromptPreview } from "./llm.ts";
import { HISTORY_LIMIT, payloadOf, type RunRow, type RunStore, readStored } from "./run-store.ts";

export interface SceneRequest {
  series: string;
  lessonKey: LessonKey;
  edition: string;
  language: string;
}

export interface SceneState {
  id: string;
  startedAt: number;
  setup: SceneSetup;
  turns: Array<LlmTurnPayload & { ts: number }>;
  goalsMet: number[];
  done: boolean;
}

export function createScenes(deps: { store: RunStore; llm: Llm; lessonContext: LessonContexts }) {
  const { store } = deps;
  /** A scene being prepared, or the line being answered, per lesson. */
  const pending = createInFlight<{ preparing: true } | { line: string }>("scene_busy");
  const latestRun = (lessonKey: LessonKey) => store.latest("scene", lessonKey);

  /** A scene as stored, from its run and its turns; undefined when its setup no longer reads (it is
   *  left out, not an error). */
  function stateOf(
    run: RunRow,
    events = store.events(run.id, ["llm_turn"]),
  ): SceneState | undefined {
    const setup = readStored(run.planJson, SceneSetup, `scene ${run.id}`);
    if (!setup) return undefined;
    const turns = events.map((e) => payloadOf<LlmTurnPayload>(e));
    return {
      id: run.id,
      startedAt: run.startedAt,
      setup,
      turns,
      goalsMet: turns.at(-1)?.goalsMet ?? [],
      done: run.status !== "active",
    };
  }

  async function turnInput(request: SceneRequest, message: string) {
    const run = latestRun(request.lessonKey);
    const state = run?.status === "active" ? stateOf(run) : undefined;
    if (!run || !state) throw new ServiceError("no_active_scene", 409);
    // A scene goes on in the edition it was set up in.
    const ctx = await deps.lessonContext.get(
      request.series,
      request.lessonKey,
      run.edition ?? request.edition,
    );
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

  /** Drafts a scene and stores it in place of the open one. */
  async function startScene(request: SceneRequest): Promise<SceneState> {
    const ctx = await deps.lessonContext.get(request.series, request.lessonKey, request.edition);
    const {
      result: setup,
      model,
      latencyMs,
    } = await deps.llm.structured(
      sceneSetupTask({
        rules: deps.llm.rulesFor("sceneSetup", request.language, ctx.target),
        language: request.language,
        target: ctx.target,
        lesson: ctx.info,
        knownVocab: ctx.knownVocab,
      }),
    );
    const run = store.atomic(() => {
      const started = store.replace(
        "scene",
        request.lessonKey,
        { status: "abandoned", reason: "user" },
        { edition: request.edition, plan: setup },
      );
      store.append(started.id, [
        {
          type: "llm_turn",
          payload: { role: "assistant", text: setup.opening, model, latencyMs, goalsMet: [] },
        },
      ]);
      return started;
    });
    return stateOf(run) as SceneState;
  }

  /** Answers the learner's line and stores both, while the scene is still the open one. */
  async function answerLine(request: SceneRequest & { text: string }): Promise<SceneState> {
    const { run, state, input } = await turnInput(request, request.text);
    const { result, model, latencyMs } = await deps.llm.structured(sceneTurnTask(input));
    const turn = cleanSceneTurn(result, request.text, state.setup.goals.length, state.goalsMet);
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
            latencyMs,
          },
        },
      ]);
      if (turn.done) store.end(run.id, "finished", "completed");
    });
    return stateOf(store.get(run.id) ?? run) as SceneState;
  }

  return {
    /** What the model is doing for the lesson's scenes now: preparing one, or answering a line. */
    pending: (lessonKey: LessonKey) => pending.get(lessonKey) ?? null,

    /** The lesson's scenes, newest first (the latest, active or finished, then earlier ones). */
    list(lessonKey: LessonKey, limit = HISTORY_LIMIT): SceneState[] {
      const runs = store.list("scene", lessonKey);
      const turns = store.eventsOf(
        runs.map((r) => r.id),
        ["llm_turn"],
      );
      return runs.flatMap((run) => stateOf(run, turns.get(run.id)) ?? []).slice(0, limit);
    },

    /** Drafts a new scene from the lesson; an unfinished one is left (abandoned). Runs to its end
     *  even when the page that asked is gone. */
    start(request: SceneRequest): Promise<SceneState> {
      return pending.run(request.lessonKey, { preparing: true }, () => startScene(request));
    },

    /** The learner's line: the partner answers, corrects and tracks the goals. */
    turn(request: SceneRequest & { text: string }) {
      return pending.run(request.lessonKey, { line: request.text }, () => answerLine(request));
    },

    async prompt(request: SceneRequest & { text: string }): Promise<PromptPreview> {
      const { input } = await turnInput(request, request.text);
      return deps.llm.preview(structuredRequest(sceneTurnTask(input)));
    },
  };
}
export type Scenes = ReturnType<typeof createScenes>;
