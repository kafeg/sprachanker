// Speaking (owner, 2026-10-12: no live conversation waiting for the
// model after every line): a task said aloud and checked once, at the end — a monologue on a card
// (`talk_card`; checked as a writing check is, said aloud), or a role-play, the learner playing one
// part of a conversation the text generator wrote (purpose `roleplay`), each of their lines a hint
// (`talk_cues`), the partner read aloud by a voice of their gender, checked line by line
// (`talk_check`). The kinds take turns in a lesson. A task is an `llm_verdict` (`task: talk_task`) in
// the lesson run the lesson shows; what was said on it, with its check and the task, a `talk` one.
// The lesson's tasks and attempts are read across its runs, newest first.
import { castVoices } from "@sprachanker/engine";
import {
  checkWritingTask,
  cleanTalkCheck,
  cleanWritingCheck,
  draftLines,
  fewWords,
  monologueCard,
  pickPurposeGenre,
  structuredRequest,
  talkCardTask,
  talkCheckTask,
  talkCuesTask,
} from "@sprachanker/llm";
import type { LessonKey, Roleplay, Run, TalkAttempt, TalkTask } from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import { createInFlight } from "./in-flight.ts";
import type { Llm, PromptPreview } from "./llm.ts";
import { HISTORY_LIMIT, type RunStore } from "./run-store.ts";
import type { MakerInputs, TextMaker, TextRequest } from "./text-maker.ts";
import { keepVerdict, type Verdict, verdicts } from "./verdicts.ts";

/** Where making a task or checking it is (said beside the time it takes). */
export type TalkStep = "writing" | "choosing" | "hinting" | "checking";

/** A conversation cut after the learner's 15th line (a hint each, at most `RoleplayCue`'s count). */
const untilLearnerLines = (lines: Roleplay["lines"], learner: string, most = 15) => {
  const last = lines.flatMap((l, n) => (l.speaker === learner ? [n] : []))[most - 1];
  return last === undefined ? lines : lines.slice(0, last + 1);
};

/** What the learner said on a task: each line as heard (or typed), with its take. */
export interface TalkRequest extends TextRequest {
  /** The task said on (its verdict's id). */
  taskId: string;
  said: TalkAttempt["said"];
}

/** The server's voices for a language now: the profile's engine and those it reads it with. */
type VoicesFor = (lang: string) => { engine: "piper" | "qwen"; voices: string[] } | undefined;

export function createTalk(deps: {
  store: RunStore;
  /** The run the lesson shows (the lessons service). */
  session: (lessonKey: LessonKey) => Promise<{ run: Run } | undefined>;
  llm: Llm;
  maker: TextMaker;
  voices?: VoicesFor;
  now?: () => number;
}) {
  const { store, llm, maker } = deps;
  const now = deps.now ?? Date.now;
  /** A task being made, or what was said being checked, per lesson. */
  const busy = createInFlight<TalkStep>("talk_busy");
  const where = (lessonKey: LessonKey) => ({ kind: "lesson" as const, about: lessonKey });
  const tasks = (lessonKey: LessonKey) => verdicts(store, "talk_task", where(lessonKey));
  const attempts = (lessonKey: LessonKey) => verdicts(store, "talk", where(lessonKey));

  async function session(lessonKey: LessonKey) {
    const shown = await deps.session(lessonKey);
    if (!shown) throw new ServiceError("no_lesson_run", 409);
    return shown.run;
  }

  /** A monologue card at the lesson's level. */
  async function card(input: MakerInputs): Promise<TalkTask> {
    const { result } = await llm.structured(
      talkCardTask({ ...input.base, rules: input.rules("talkCard") }),
      { timeoutAgain: true },
    );
    return monologueCard(result, input.ctx.info.level);
  }

  /** A role-play: a conversation drafted for it, its learner's lines given hints, its partner a
   *  voice of their gender. */
  async function roleplay(
    input: MakerInputs,
    lessonKey: LessonKey,
    step: (now: TalkStep) => void,
  ): Promise<TalkTask> {
    const recent = tasks(lessonKey)
      .slice(0, 4)
      .flatMap((t) => (t.result.kind === "roleplay" && t.result.genre ? [t.result.genre] : []));
    const genre = pickPurposeGenre(
      "roleplay",
      input.ctx.info.level,
      recent,
      maker.random,
      fewWords(input.ctx.info),
    );
    const { draft } = await maker.draft(input, genre, step, "roleplay");
    const [partner, learner] = draft.people;
    if (!partner || !learner) throw new ServiceError("no_such_item", 502);
    const lines = untilLearnerLines(draftLines(draft, genre).lines.slice(0, 30), learner.name);
    step("hinting");
    const { result } = await llm.structured(
      talkCuesTask({
        language: input.base.language,
        target: input.base.target,
        rules: input.rules("talkCues"),
        lines,
        learner: learner.name,
      }),
      { timeoutAgain: true },
    );
    const here = deps.voices?.(input.ctx.target);
    const voice = here
      ? castVoices(here.engine, [partner], here.voices, maker.random)[partner.name]
      : undefined;
    const task: Roleplay = {
      kind: "roleplay",
      genre: genre.id,
      setting: draft.setting,
      situation: draft.situation,
      role: learner.role,
      learner: learner.name,
      partner: { name: partner.name, gender: partner.gender, age: partner.age },
      ...(here && voice && { voice: { engine: here.engine, id: voice } }),
      lines,
      cues: result.cues.slice(0, 15),
      glossary: [],
    };
    return task;
  }

  async function make(request: TextRequest): Promise<Verdict<"talk_task">> {
    const run = await session(request.lessonKey);
    const started = now();
    const input = await maker.inputs(request);
    const step = (at: TalkStep) => busy.set(request.lessonKey, at);
    // The kinds take turns; the first drawn.
    const last = tasks(request.lessonKey)[0]?.result.kind;
    const kind = last
      ? last === "monologue"
        ? "roleplay"
        : "monologue"
      : maker.random() < 0.5
        ? "monologue"
        : "roleplay";
    step("writing");
    const task =
      kind === "monologue" ? await card(input) : await roleplay(input, request.lessonKey, step);
    return keepVerdict(store, run.id, {
      task: "talk_task",
      input: "",
      result: task,
      model: (await llm.model()).model,
      latencyMs: Math.max(0, Math.round(now() - started)),
    }).verdict;
  }

  return {
    /** The lesson's latest task, its attempts (newest first), and what is being done now. */
    state(lessonKey: LessonKey) {
      const at = busy.get(lessonKey) ?? null;
      return {
        task: tasks(lessonKey)[0] ?? null,
        attempts: attempts(lessonKey).slice(0, HISTORY_LIMIT),
        preparing: !!at && at !== "checking",
        checking: at === "checking",
        step: at,
      };
    },

    /** Makes a task for the lesson and keeps it in the run the lesson shows. Runs to its end even
     *  when the page that asked is gone. */
    start(request: TextRequest): Promise<Verdict<"talk_task">> {
      return busy.run(request.lessonKey, "writing", () => make(request));
    },

    /** Makes a task ahead (the lesson started) unless one is being made or the latest has no attempt
     *  yet; its failure only logged. */
    async prepare(request: TextRequest) {
      if (busy.get(request.lessonKey)) return;
      const latest = tasks(request.lessonKey)[0];
      if (latest && !attempts(request.lessonKey).some((a) => a.ts > latest.ts)) return;
      await this.start(request).catch((error: unknown) => {
        console.warn(`speaking made ahead: ${(error as Error).message}`);
      });
    },

    /** Checks what was said on a task and keeps it, with its check and the task, in the run the
     *  lesson shows. Runs to its end even when the page that asked is gone. */
    check(request: TalkRequest): Promise<Verdict<"talk">> {
      return busy.run(request.lessonKey, "checking", async () => {
        const run = await session(request.lessonKey);
        const found = tasks(request.lessonKey).find((t) => t.id === request.taskId);
        if (!found) throw new ServiceError("no_such_item", 404);
        const task = found.result;
        const started = now();
        const input = await maker.inputs(request);
        const text = request.said.map((s) => s.text.trim()).join(" ");
        const { result, model } =
          task.kind === "monologue"
            ? await llm
                .structured(
                  checkWritingTask({
                    ...input.base,
                    rules: input.rules("writing"),
                    task: {
                      situation: `${task.instruction} (${task.topic})`,
                      points: task.points,
                      words: task.seconds * 2,
                    },
                    text,
                    spoken: true,
                  }),
                )
                .then((r) => ({ ...r, result: cleanWritingCheck(r.result, text) }))
            : await llm
                .structured(
                  talkCheckTask({
                    ...input.base,
                    rules: input.rules("talkCheck"),
                    task,
                    said: request.said,
                  }),
                )
                .then((r) => ({ ...r, result: cleanTalkCheck(r.result) }));
        return keepVerdict(store, run.id, {
          task: "talk",
          input: text,
          result: { task, said: request.said, check: result },
          model,
          latencyMs: Math.max(0, Math.round(now() - started)),
        }).verdict;
      });
    },

    /** The request a new monologue card would send. */
    async prompt(request: TextRequest): Promise<PromptPreview> {
      const input = await maker.inputs(request);
      return llm.preview(
        structuredRequest(talkCardTask({ ...input.base, rules: input.rules("talkCard") })),
      );
    },
  };
}
export type Talk = ReturnType<typeof createTalk>;
