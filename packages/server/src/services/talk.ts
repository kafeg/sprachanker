// Speaking (owner, 2026-10-12: no live conversation waiting for the
// model after every line): a task said aloud and checked once, at the end — a monologue on a card
// (`talk_card`; checked as a writing check is, said aloud), or a role-play, the learner playing one
// part of a conversation the text generator wrote (purpose `roleplay`), each of their lines a hint
// (`talk_cues`), the partner read aloud by a voice of their gender, checked line by line
// (`talk_check`). The kinds take turns in a lesson's practice; a role-play's partner lines are
// recorded by Qwen3-TTS when it is made (none to read them: a monologue). Each task made goes into
// the course's practice (practice.ts); the learner's step takes the next variant they have not had
// from there, as an `llm_verdict` (`task: talk_task`, `variant`) in the lesson run the lesson shows;
// what was said on it, with its check and the task, a `talk` one. The lesson's tasks and attempts are
// read across its runs, newest first.
import { castVoices, readingPieces } from "@sprachanker/engine";
import {
  checkWritingTask,
  cleanTalkCheck,
  cleanWritingCheck,
  draftLines,
  fewWords,
  monologueCard,
  pickPurposeGenre,
  structuredRequest,
  type TextGenre,
  talkCardTask,
  talkCheckTask,
  talkCuesTask,
  type UnderstandingDraft,
} from "@sprachanker/llm";
import {
  type LessonKey,
  parseEditionId,
  practiceRecordingPath,
  type Roleplay,
  type Run,
  type TalkAttempt,
  type TalkTask,
} from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import { createInFlight } from "./in-flight.ts";
import type { Llm, PromptPreview } from "./llm.ts";
import type { Practice, PracticeReader } from "./practice.ts";
import { HISTORY_LIMIT, type RunStore } from "./run-store.ts";
import { keptOf, type MakerInputs, type TextMaker, type TextRequest } from "./text-maker.ts";
import { keepVerdict, type Verdict, verdicts } from "./verdicts.ts";
import { joinWavs } from "./wav.ts";

/** Where making a task or checking it is (said beside the time it takes). */
export type TalkStep = "writing" | "choosing" | "hinting" | "recording" | "checking";

/** The pause between the pieces of a partner's line recorded. */
const PIECE_PAUSE_MS = 250;

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

export function createTalk(deps: {
  store: RunStore;
  /** The run the lesson shows (the lessons service). */
  session: (lessonKey: LessonKey) => Promise<{ run: Run } | undefined>;
  llm: Llm;
  maker: TextMaker;
  /** The course's practice: tasks made go there, a step takes its next from there. */
  practice: Practice;
  /** Qwen3-TTS reading a language: a role-play's partner recorded with it (none: no role-play). */
  reader?: (lang: string) => PracticeReader | undefined;
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

  /** Conversations drafted for role-plays in one round: up to `want` (the best, and others that
   *  pass), with the genre drawn. */
  async function roleplayDrafts(
    input: MakerInputs,
    made: TalkTask[],
    step: (now: TalkStep) => void,
    want: number,
  ) {
    const recent = made
      .slice(-4)
      .flatMap((t) => (t.kind === "roleplay" && t.genre ? [t.genre] : []));
    const genre = pickPurposeGenre(
      "roleplay",
      input.ctx.info.level,
      recent,
      maker.random,
      fewWords(input.ctx.info),
    );
    const best = await maker.draft(input, genre, step, "roleplay", want);
    return { genre, drafts: [best.draft, ...best.more.map((m) => m.draft)] };
  }

  /** A role-play of a drafted conversation: its learner's lines given hints, its partner a voice of
   *  their gender. */
  async function roleplay(
    input: MakerInputs,
    genre: TextGenre,
    draft: UnderstandingDraft,
    reader: PracticeReader,
    step: (now: TalkStep) => void,
  ): Promise<Roleplay> {
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
    const voice = castVoices(reader.engine, [partner], reader.voices, maker.random)[partner.name];
    const task: Roleplay = {
      kind: "roleplay",
      genre: genre.id,
      setting: draft.setting,
      situation: draft.situation,
      role: learner.role,
      learner: learner.name,
      partner: { name: partner.name, gender: partner.gender, age: partner.age },
      ...(voice && { voice: { engine: reader.engine, id: voice } }),
      lines,
      cues: result.cues.slice(0, 15),
      glossary: [],
    };
    return task;
  }

  /** A role-play's partner lines recorded by their voice, each read piece by piece. */
  async function recorded(
    task: Roleplay,
    reader: PracticeReader,
    request: TextRequest,
    id: string,
  ) {
    const recordings: Record<string, string> = {};
    const files: Array<{ path: string; wav: Uint8Array }> = [];
    const voice = task.voice?.id ?? (reader.voices[0] as string);
    for (const [n, line] of task.lines.entries()) {
      if (line.speaker === task.learner) continue;
      const parts: Array<{ wav: Uint8Array; pauseMs: number }> = [];
      for (const piece of readingPieces(line.text))
        parts.push({ wav: await reader.read(piece, voice), pauseMs: PIECE_PAUSE_MS });
      const wav = joinWavs(parts);
      if (!wav) throw new ServiceError("speech_engine_failed", 502);
      const path = practiceRecordingPath(request.lessonKey, request.edition, `${id}-${n}`);
      recordings[String(n)] = path;
      files.push({ path, wav });
    }
    return { task: { ...task, recordings }, files };
  }

  /** Up to `want` tasks made and added to the course's practice: how many were. The kinds take turns
   *  there (the first drawn; no reader for the language: monologues); the role-plays among them
   *  drafted in one round. */
  async function make(request: TextRequest, want = 1) {
    const r = { ...request, language: deps.practice.language(request.edition) };
    const input = await maker.inputs(r);
    const step = (at: TalkStep) => busy.set(request.lessonKey, at);
    const made = ((await deps.practice.lesson(r))?.speaking ?? []).map((v) => v.task);
    const reader = deps.reader?.(parseEditionId(request.edition).target);
    let last = made.at(-1)?.kind ?? (maker.random() < 0.5 ? "roleplay" : "monologue");
    const kinds = Array.from({ length: want }, () => {
      last = !reader || last === "roleplay" ? "monologue" : "roleplay";
      return last;
    });
    step("writing");
    const model = (await llm.model()).model;
    const plays = kinds.filter((k) => k === "roleplay").length;
    const round = reader && plays ? await roleplayDrafts(input, made, step, plays) : undefined;
    const tasks: Array<"monologue" | UnderstandingDraft> = [
      ...kinds.filter((k) => k === "monologue").map(() => "monologue" as const),
      ...(round?.drafts ?? []),
    ];
    return keptOf(tasks, async (what) => {
      if (what === "monologue" || !reader || !round) {
        step("writing");
        const task = await card(input);
        await deps.practice.add(r, { step: "speaking", variant: { model, madeAt: now(), task } });
        return;
      }
      const drafted = await roleplay(input, round.genre, what, reader, step);
      step("recording");
      const id = await deps.practice.newId(request);
      const { task, files } = await recorded(drafted, reader, r, id);
      await deps.practice.add(
        r,
        { step: "speaking", variant: { model, madeAt: now(), task } },
        files,
        id,
      );
    });
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

    /** Makes `count` tasks for the lesson into the course's practice, then takes the step's next
     *  the learner has not had into the run the lesson shows. Runs to its end even when the page that
     *  asked is gone. */
    start(request: TextRequest, count = 1): Promise<Verdict<"talk_task">> {
      return busy.run(request.lessonKey, "writing", async () => {
        await deps.practice.run(request.lessonKey);
        for (let done = 0; done < count; ) done += await make(request, count - done);
        const taken = await deps.practice.take(request, "speaking");
        if (!taken) throw new ServiceError("no_such_item", 404);
        return taken;
      });
    },

    /** Makes `count` tasks for the lesson into the course's practice, nothing taken. */
    make(request: TextRequest, count = 1) {
      return busy.run(request.lessonKey, "writing", async () => {
        for (let done = 0; done < count; ) done += await make(request, count - done);
      });
    },

    /** The lesson started: unless a task is being made or the latest has no attempt yet, the step's
     *  next task of the course's practice is taken — one is made first when none is left and
     *  `makeIfNone`; a failure only logged. */
    async prepare(request: TextRequest, makeIfNone: boolean) {
      if (busy.get(request.lessonKey)) return;
      const latest = tasks(request.lessonKey)[0];
      if (latest && !attempts(request.lessonKey).some((a) => a.ts > latest.ts)) return;
      try {
        if (await deps.practice.take(request, "speaking")) return;
        if (makeIfNone) await this.start(request);
      } catch (error) {
        console.warn(`speaking made ahead: ${(error as Error).message}`);
      }
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
