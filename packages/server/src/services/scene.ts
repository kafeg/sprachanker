// The Dialogue (04, "AI practice in courses"; 07): a conversation on the lesson's goals held by voice,
// one `scene` run each — the setup (with what the partner knows, hidden until it is over) in the run's
// plan, the lines as `llm_turn` events, its summary an `llm_verdict` (`task: dialogue`). It ends when
// its goals are reached, the learner ends it or a new one is started; the lesson's Dialogues stay
// readable, newest first.
import {
  cleanSceneSummary,
  cleanSceneTurn,
  type SceneTurnInput,
  sceneSetupTask,
  sceneSummaryTask,
  sceneTurnTask,
  structuredRequest,
} from "@sprachanker/llm";
import {
  type DialogueSummary,
  type LessonKey,
  type LlmTurnPayload,
  SceneSetup,
} from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import { createInFlight } from "./in-flight.ts";
import type { LessonContexts } from "./lesson-context.ts";
import type { Llm, PromptPreview } from "./llm.ts";
import {
  HISTORY_LIMIT,
  payloadOf,
  type ReadEvent,
  type RunRow,
  type RunStore,
  readStored,
} from "./run-store.ts";
import { keepVerdict } from "./verdicts.ts";

interface SceneRequest {
  series: string;
  lessonKey: LessonKey;
  edition: string;
  language: string;
}

/** The learner's line: as the recogniser heard it (with its take) or typed. */
interface SceneLine extends SceneRequest {
  text: string;
  spoken?: boolean;
  recording?: string;
}

export interface SceneState {
  id: string;
  startedAt: number;
  /** Its setup; what the partner knows only once it is over. */
  setup: SceneSetup;
  turns: Array<LlmTurnPayload & { ts: number }>;
  goalsMet: number[];
  done: boolean;
  /** Once over: its summary (null until made, or when making it failed). */
  summary: (DialogueSummary & { model: string }) | null;
}

type Pending = { preparing: true } | { line: string } | { summing: true };

export function createScenes(deps: { store: RunStore; llm: Llm; lessonContext: LessonContexts }) {
  const { store } = deps;
  /** A Dialogue being prepared, the line being answered or the summary being made, per lesson. */
  const pending = createInFlight<Pending>("scene_busy");
  const latestRun = (lessonKey: LessonKey) => store.latest("scene", lessonKey);

  /** A Dialogue as stored, from its run, its turns and its summary; undefined when its setup no
   *  longer reads (it is left out, not an error). */
  function stateOf(
    run: RunRow,
    events = store.events(run.id, ["llm_turn", "llm_verdict"]),
  ): SceneState | undefined {
    const stored = readStored(run.planJson, SceneSetup, `scene ${run.id}`);
    if (!stored) return undefined;
    const done = run.status !== "active";
    const { partnerInfo, ...shown } = stored;
    const turns = events.flatMap((e) =>
      e.type === "llm_turn" ? [payloadOf<LlmTurnPayload>(e)] : [],
    );
    const summary = events.findLast(
      (e): e is Extract<ReadEvent, { type: "llm_verdict" }> =>
        e.type === "llm_verdict" && e.payload.task === "dialogue",
    )?.payload;
    return {
      id: run.id,
      startedAt: run.startedAt,
      setup: done && partnerInfo ? { ...shown, partnerInfo } : shown,
      turns,
      goalsMet: turns.findLast((t) => t.goalsMet)?.goalsMet ?? [],
      done,
      summary: summary?.task === "dialogue" ? { ...summary.result, model: summary.model } : null,
    };
  }

  /** The lesson as the tasks see it, in the edition the Dialogue was set up in. */
  const lessonOf = (request: SceneRequest, run: RunRow) =>
    deps.lessonContext.get(request.series, request.lessonKey, run.edition ?? request.edition);

  /** The open Dialogue with its full setup; 409 when there is none. */
  function open(lessonKey: LessonKey) {
    const run = latestRun(lessonKey);
    const setup = run?.status === "active" && readStored(run.planJson, SceneSetup, "scene");
    const state = run && setup && stateOf(run);
    if (!run || !setup || !state) throw new ServiceError("no_active_scene", 409);
    return { run, setup, state };
  }

  async function turnInput(request: SceneLine) {
    const { run, setup, state } = open(request.lessonKey);
    const ctx = await lessonOf(request, run);
    const input: SceneTurnInput = {
      language: request.language,
      target: ctx.target,
      rules: deps.llm.rulesFor("scene", request.language, ctx.target),
      lesson: ctx.info,
      setup,
      history: state.turns.map((t) => ({ role: t.role, text: t.text })),
      message: request.text,
      ...(request.spoken && { spoken: true }),
    };
    return { run, state, input };
  }

  /** Drafts a Dialogue and stores it in place of the open one. */
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

  /** Sums up an ended Dialogue and keeps the summary in its run; a failed call keeps none (the page
   *  asks again), unless `strict`, when its error is the answer. */
  async function summarize(request: SceneRequest, run: RunRow, strict: boolean) {
    const state = stateOf(store.get(run.id) ?? run);
    const setup = readStored(run.planJson, SceneSetup, "scene");
    if (!state || !setup) return;
    try {
      const ctx = await lessonOf(request, run);
      const { result, model, latencyMs } = await deps.llm.structured(
        sceneSummaryTask({
          language: request.language,
          target: ctx.target,
          rules: deps.llm.rulesFor("sceneSummary", request.language, ctx.target),
          lesson: ctx.info,
          setup,
          goalsMet: state.goalsMet,
          turns: state.turns,
        }),
      );
      const learner = state.turns.flatMap((t) => (t.role === "user" ? [t.text] : []));
      keepVerdict(store, run.id, {
        task: "dialogue",
        input: "",
        result: cleanSceneSummary(result, learner),
        model,
        latencyMs,
      });
    } catch (error) {
      if (strict) throw error;
    }
  }

  /** Answers the learner's line and stores both, while the Dialogue is still the open one; one that
   *  reaches its goals ends and is summed up. */
  async function answerLine(request: SceneLine): Promise<SceneState> {
    const { run, state, input } = await turnInput(request);
    const { result, model, latencyMs } = await deps.llm.structured(sceneTurnTask(input));
    const turn = cleanSceneTurn(result, request.text, state.setup.goals.length, state.goalsMet);
    // Stored only while this Dialogue is still active (not ended or replaced during the call).
    store.atomic(() => {
      store.append(run.id, [
        {
          type: "llm_turn",
          payload: {
            role: "user",
            text: request.text,
            corrections: turn.corrections,
            understood: turn.understood,
            fits: turn.fits,
            ...(request.spoken && { spoken: true as const }),
            ...(request.recording && { recording: request.recording }),
          },
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
    if (turn.done) await summarize(request, run, false);
    return stateOf(store.get(run.id) ?? run) as SceneState;
  }

  return {
    /** What the model is doing for the lesson's Dialogues now: preparing one, answering a line or
     *  summing one up. */
    pending: (lessonKey: LessonKey) => pending.get(lessonKey) ?? null,

    /** The lesson's Dialogues, newest first (the latest, active or finished, then earlier ones). */
    list(lessonKey: LessonKey, limit = HISTORY_LIMIT): SceneState[] {
      const runs = store.list("scene", lessonKey);
      const events = store.eventsOf(
        runs.map((r) => r.id),
        ["llm_turn", "llm_verdict"],
      );
      return runs.flatMap((run) => stateOf(run, events.get(run.id)) ?? []).slice(0, limit);
    },

    /** Drafts a new Dialogue from the lesson; an unfinished one is left (abandoned). Runs to its end
     *  even when the page that asked is gone. */
    start(request: SceneRequest): Promise<SceneState> {
      return pending.run(request.lessonKey, { preparing: true }, () => startScene(request));
    },

    /** The learner's line: the partner answers, judges and corrects it, and tracks the goals. */
    turn(request: SceneLine) {
      return pending.run(request.lessonKey, { line: request.text }, () => answerLine(request));
    },

    /** Ends the open Dialogue (the learner's choice) and sums it up. */
    end(request: SceneRequest): Promise<SceneState> {
      return pending.run(request.lessonKey, { summing: true }, async () => {
        const { run } = open(request.lessonKey);
        store.end(run.id, "finished", "user");
        await summarize(request, run, false);
        return stateOf(store.get(run.id) ?? run) as SceneState;
      });
    },

    /** Sums up the latest Dialogue again when it is over without a summary (the call failed); its
     *  error is the answer this time. */
    summary(request: SceneRequest): Promise<SceneState> {
      return pending.run(request.lessonKey, { summing: true }, async () => {
        const run = latestRun(request.lessonKey);
        const state = run && stateOf(run);
        if (!run || !state?.done) throw new ServiceError("no_active_scene", 409);
        if (!state.summary) await summarize(request, run, true);
        return stateOf(store.get(run.id) ?? run) as SceneState;
      });
    },

    async prompt(request: SceneLine): Promise<PromptPreview> {
      const { input } = await turnInput(request);
      return deps.llm.preview(structuredRequest(sceneTurnTask(input)));
    },
  };
}
export type Scenes = ReturnType<typeof createScenes>;
