// Reading and Listening: a short text in the language learnt on the
// lesson's topic, made by the text generator — a genre picked by code (not one of the step's last in
// the course's practice), drafts written side by side (`understanding_draft`), rated
// (`understanding_judge`) and the best that passes kept (none passing: the best written again with
// its problems, once; still none, nothing is shown), questions asked on it
// (`understanding_questions`) and read again with the text and without it (`understanding_check`) so
// only those the text settles as their key does, and common sense does not, are kept (asked again
// once when fewer than four are). A text to hear is recorded: its people given Qwen3-TTS's voices by
// gender and age, its lines read by them. Each text made goes into the course's practice
// (practice.ts) — the learner's step takes the next variant they have not had from there — and is
// kept as an `llm_verdict` (`task: understanding`, `variant`) in the lesson run the lesson shows;
// each answer a `practice_answered` event on it, checked here by the engine, never by a model. The
// lesson's texts are read across its runs, newest first; a text before the two steps counts as
// Listening's (Reading's when it was to read).
import {
  castVoices,
  checkUnderstanding,
  newGlosses,
  readingPieces,
  stepOf,
  textVoices,
  unaskedGlosses,
  understandingStage,
} from "@sprachanker/engine";
import {
  fewWords,
  LlmError,
  pickAreas,
  pickGenre,
  questionsFor,
  settledQuestions,
  structuredRequest,
  type TextGenre,
  UNDERSTANDING_MIN_QUESTIONS,
  understandingCheckTask,
  understandingDraftTask,
  understandingQuestionsTask,
  understandingText,
} from "@sprachanker/llm";
import {
  type LessonKey,
  type Outcome,
  type PracticeStep,
  parseEditionId,
  parseLessonKey,
  practiceRecordingPath,
  type UnderstandingText,
} from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import { createInFlight } from "./in-flight.ts";
import type { Llm, PromptPreview } from "./llm.ts";
import type { Practice, PracticeReader } from "./practice.ts";
import { HISTORY_LIMIT, type RunStore } from "./run-store.ts";
import type { Drafted, MakerInputs, TextMaker } from "./text-maker.ts";
import {
  keepPracticeAnswer,
  type PracticeAnswer,
  practiceAnswers,
  type Verdict,
  verdicts,
} from "./verdicts.ts";
import { joinWavs } from "./wav.ts";

/** What a text being made is at (said beside the time it takes): drafts written, the best
 *  chosen, questions asked, read again, recorded. */
export type UnderstandingStep = "writing" | "choosing" | "asking" | "checking" | "recording";

/** Pauses in a text's recording: between a speaker's sentences, and before another line. */
const PAUSE_MS = { piece: 250, line: 650 };

export interface UnderstandingRequest {
  series: string;
  lessonKey: LessonKey;
  edition: string;
  language: string;
  step: PracticeStep;
}

/** An answer to one of a text's questions: the verdict that set it, the question's index. */
export interface UnderstandingAnswer extends Omit<UnderstandingRequest, "step"> {
  id: string;
  question: number;
  answer: unknown;
}

/** A text as the steps and the Notebook read it: the verdict with its answers in the order given. */
export type Understood = Verdict<"understanding"> & { answers: PracticeAnswer[] };

/** The server's voices for a language now: the profile's engine and those it reads it with. */
type VoicesFor = (lang: string) => { engine: "piper" | "qwen"; voices: string[] } | undefined;

export function createUnderstanding(deps: {
  store: RunStore;
  llm: Llm;
  /** The text generator: drafts rated, the best kept. */
  maker: TextMaker;
  /** The course's practice: texts made go there, a step takes its next from there. */
  practice: Practice;
  /** Qwen3-TTS reading a language, a text to hear recorded with it (none: none is made). */
  reader?: (lang: string) => PracticeReader | undefined;
  /** A recording of the course's practice (its path in the series folder), if it is there. */
  recording?: (series: string, path: string) => Promise<Uint8Array | undefined>;
  /** Texts made before the course's practice: the voices their people had, a line read aloud. */
  voices?: VoicesFor;
  say?: (text: string, lang: string, voice?: string) => Promise<Uint8Array>;
  now?: () => number;
}) {
  const { store, llm } = deps;
  const { random } = deps.maker;
  const now = deps.now ?? Date.now;
  /** A text being made, per lesson and step. */
  const making = createInFlight<UnderstandingStep>("understanding_busy");
  const key = (lessonKey: LessonKey, step: PracticeStep) => `${lessonKey}#${step}`;

  /** The lesson's texts in all its runs, newest first, each with its answers; a step's only, given
   *  one. */
  function texts(lessonKey: LessonKey, step?: PracticeStep): Understood[] {
    const where = { kind: "lesson" as const, about: lessonKey };
    const answers = practiceAnswers(store, where);
    return verdicts(store, "understanding", where)
      .filter((v) => !step || stepOf(v.result) === step)
      .map((v) => ({ ...v, answers: answers.get(v.id) ?? [] }));
  }

  /** The genre of a new text: not one of the step's last three in the course's practice of the
   *  lesson. */
  async function genreFor(
    request: UnderstandingRequest,
    level: string | undefined,
    few: boolean,
  ): Promise<TextGenre> {
    const recent = ((await deps.practice.lesson(request))?.[request.step] ?? [])
      .slice(-3)
      .flatMap((v) => (v.text.genre ? [v.text.genre] : []));
    return pickGenre(request.step, level, recent, random, few);
  }

  /** The lesson's inputs, in the course's practice language (the edition's: every profile's). */
  const inputs = (request: UnderstandingRequest) =>
    deps.maker.inputs({ ...request, language: deps.practice.language(request.edition) });

  /** Questions asked on a text and read again — with the text and without it —: those settled. */
  async function askedText(
    input: MakerInputs,
    request: UnderstandingRequest,
    genre: TextGenre,
    best: Drafted,
    step: (now: UnderstandingStep) => void,
  ) {
    const { base, rules, ctx } = input;
    const lines = understandingText(request.step, genre, best.draft, {
      questions: [],
      glossary: [],
    }).lines;
    const typedRight = (q: Parameters<typeof checkUnderstanding>[0], answer: string) =>
      checkUnderstanding(q, { g1: answer }, ctx.target).result === "correct";
    const ask = async () => {
      step("asking");
      const asked = await llm.structured(
        understandingQuestionsTask({
          ...base,
          rules: rules("understandingQuestions"),
          step: request.step,
          text: { lines },
          facts: best.draft.facts,
          count: questionsFor(genre, ctx.info),
        }),
        { timeoutAgain: true },
      );
      const text = understandingText(request.step, genre, best.draft, asked.result, {
        ...best.rating,
        drafts: best.drafts,
      });
      step("checking");
      const check = { language: base.language, target: base.target, text };
      const checkRules = rules("understandingCheck");
      const [read, blind] = await Promise.all([
        llm.structured(understandingCheckTask({ ...check, rules: checkRules }), {
          timeoutAgain: true,
        }),
        llm
          .structured(understandingCheckTask({ ...check, rules: checkRules, blind: true }))
          .catch(() => undefined),
      ]);
      return settledQuestions(text, read.result, typedRight, blind?.result);
    };
    let text = await ask();
    // Too few settled: asked again once, the better kept.
    if (text.questions.length < UNDERSTANDING_MIN_QUESTIONS) {
      const again = await ask().catch(() => undefined);
      if (again && again.questions.length > text.questions.length) text = again;
    }
    if (!text.questions.length)
      throw new LlmError("invalid_output", "no question the text settles");
    // New words only: a word of the lesson or met before is never glossed as new, nor one a
    // question asks the meaning of (the glossary would give its answer away).
    const known = [...ctx.info.vocab, ...(ctx.info.knownWords ?? [])];
    const glossary = newGlosses(unaskedGlosses(text.glossary, text.questions), known);
    return { ...text, glossary } satisfies UnderstandingText;
  }

  /** The text's people given the reader's voices, by gender and age. */
  function voiced(text: UnderstandingText, reader: PracticeReader): UnderstandingText {
    if (!reader.voices.length || !text.people?.length) return text;
    const by = castVoices(reader.engine, text.people, reader.voices, random);
    return Object.keys(by).length ? { ...text, voices: { engine: reader.engine, by } } : text;
  }

  /** Each piece of a text to hear with its voice, as its recording reads it (by the voices its
   *  people have; a text before its people were known: the reader's or the profile's own voice). */
  function pieces(
    id: string,
    text: UnderstandingText,
    here: { engine: "piper" | "qwen"; voices: string[] } | undefined,
  ) {
    const by = textVoices(id, text.people ?? [], text.voices, here);
    return text.lines.flatMap((l, i) =>
      readingPieces(l.text).map((piece, k, all) => ({
        piece,
        voice: l.speaker ? by[l.speaker] : undefined,
        pauseMs: k < all.length - 1 || i === text.lines.length - 1 ? PAUSE_MS.piece : PAUSE_MS.line,
      })),
    );
  }

  /** A text made and added to the course's practice: a text to hear recorded first. */
  async function make(request: UnderstandingRequest) {
    const target = parseEditionId(request.edition).target;
    const reader = request.step === "listening" ? deps.reader?.(target) : undefined;
    if (request.step === "listening" && !reader)
      throw new ServiceError("practice_needs_voice", 409);
    const input = await inputs(request);
    const step = (at: UnderstandingStep) => making.set(key(request.lessonKey, request.step), at);
    const genre = await genreFor(request, input.ctx.info.level, fewWords(input.ctx.info));
    const best = await deps.maker.draft(input, genre, step);
    const asked = await askedText(input, request, genre, best, step);
    const id = await deps.practice.newId(request);
    if (!reader) {
      await deps.practice.add(
        request,
        { step: request.step, variant: { model: best.model, madeAt: now(), text: asked } },
        undefined,
        id,
      );
      return;
    }
    step("recording");
    const text = voiced(asked, reader);
    const parts: Array<{ wav: Uint8Array; pauseMs: number }> = [];
    for (const { piece, voice, pauseMs } of pieces(id, text, reader))
      parts.push({ wav: await reader.read(piece, voice ?? (reader.voices[0] as string)), pauseMs });
    const wav = joinWavs(parts);
    if (!wav) throw new ServiceError("speech_engine_failed", 502);
    const recording = practiceRecordingPath(request.lessonKey, request.edition, id);
    await deps.practice.add(
      request,
      {
        step: request.step,
        variant: { model: best.model, madeAt: now(), text: { ...text, recording } },
      },
      [{ path: recording, wav }],
      id,
    );
  }

  /** The step's next text of the course's practice the learner has not had, taken into the run. */
  async function take(request: UnderstandingRequest): Promise<Understood | undefined> {
    const taken = await deps.practice.take(request, request.step);
    return taken && { ...taken, answers: [] };
  }

  return {
    /** A step's texts of the lesson, newest first, and whether one is being made now, at which
     *  step. */
    state(lessonKey: LessonKey, step: PracticeStep) {
      const at = making.get(key(lessonKey, step)) ?? null;
      return { texts: texts(lessonKey, step).slice(0, HISTORY_LIMIT), preparing: !!at, step: at };
    },

    /** Makes `count` texts for the lesson's step into the course's practice (none: only takes),
     *  then takes the step's next the learner has not had into the run the lesson shows. Runs to its
     *  end even when the page that asked is gone. */
    start(request: UnderstandingRequest, count = 1): Promise<Understood> {
      return making.run(key(request.lessonKey, request.step), "writing", async () => {
        await deps.practice.run(request.lessonKey);
        for (let i = 0; i < count; i++) await make(request);
        const taken = await take(request);
        if (!taken) throw new ServiceError("no_such_item", 404);
        return taken;
      });
    },

    /** Makes `count` texts for the lesson's step into the course's practice, nothing taken (a
     *  course's practice made ahead). */
    make(request: UnderstandingRequest, count = 1) {
      return making.run(key(request.lessonKey, request.step), "writing", async () => {
        for (let i = 0; i < count; i++) await make(request);
      });
    },

    /** The lesson started: unless a text is being made or the step's latest is not answered through
     *  (untouched or half done: the learner's to finish), the step's next text of the course's
     *  practice is taken — one is made first when none is left and `makeIfNone` (a model set up, the
     *  setting on); a failure only logged. */
    async prepare(request: UnderstandingRequest, makeIfNone: boolean) {
      if (making.get(key(request.lessonKey, request.step))) return;
      const latest = texts(request.lessonKey, request.step)[0];
      const answered = (n: number) => !!latest?.answers.some((a) => a.question === n);
      if (latest && understandingStage(latest.result, answered).stage !== "done") return;
      try {
        if (await take(request)) return;
        if (makeIfNone) await this.start(request);
      } catch (error) {
        console.warn(`${request.step} made ahead: ${(error as Error).message}`);
      }
    },

    /** An answer to a text's question, checked by the engine and kept on the text in its run; a
     *  question answered already keeps its first answer. */
    answer(request: UnderstandingAnswer): Understood {
      const event = store.event(request.id);
      const run = event && store.get(event.runId, "lesson", request.lessonKey);
      if (!run || event?.type !== "llm_verdict" || event.payload.task !== "understanding")
        throw new ServiceError("no_such_item", 404);
      const question = event.payload.result.questions[request.question];
      if (!question) throw new ServiceError("no_such_item", 404);
      const lang = parseEditionId(run.edition ?? request.edition).target;
      let outcome: Outcome;
      try {
        outcome = checkUnderstanding(question, request.answer, lang);
      } catch {
        throw new ServiceError("answer_does_not_fit");
      }
      keepPracticeAnswer(store, run.id, {
        verdict: request.id,
        question: request.question,
        answer: request.answer,
        outcome,
      });
      return texts(request.lessonKey).find((t) => t.id === request.id) as Understood;
    },

    /** A text's recording: the one made with the course's practice — not here (a bundle without
     *  it), read again as it was made —; a text before it, its lines read by its people's voices
     *  with pauses between, one WAV (the server's engine reads the language, else 409). */
    async audio(lessonKey: LessonKey, id: string): Promise<Uint8Array<ArrayBuffer>> {
      const event = store.event(id);
      const run = event && store.get(event.runId, "lesson", lessonKey);
      if (!run?.edition || event?.type !== "llm_verdict" || event.payload.task !== "understanding")
        throw new ServiceError("no_such_item", 404);
      const text = event.payload.result;
      const lang = parseEditionId(run.edition).target;
      const reader = text.recording ? deps.reader?.(lang) : undefined;
      if (text.recording) {
        const series = parseLessonKey(lessonKey).course.split("/")[0] as string;
        const kept = await deps.recording?.(series, text.recording);
        if (kept) return new Uint8Array(kept);
      }
      const say = reader
        ? (piece: string, _: string, voice?: string) => reader.read(piece, voice ?? "")
        : deps.say;
      const here = reader ? { engine: reader.engine, voices: reader.voices } : deps.voices?.(lang);
      if (!say || !here) throw new ServiceError("speech_unavailable", 409);
      const parts: Array<{ wav: Uint8Array; pauseMs: number }> = [];
      for (const { piece, voice, pauseMs } of pieces(id, text, here))
        parts.push({ wav: await say(piece, lang, voice), pauseMs });
      const wav = joinWavs(parts);
      if (!wav) throw new ServiceError("speech_unavailable", 409);
      return wav;
    },

    /** The request a draft would send (a genre of the step picked as for a new text). */
    async prompt(request: UnderstandingRequest): Promise<PromptPreview> {
      const input = await inputs(request);
      const genre = await genreFor(request, input.ctx.info.level, fewWords(input.ctx.info));
      return llm.preview(
        structuredRequest(
          understandingDraftTask({
            ...input.base,
            rules: input.rules("understandingDraft"),
            genre,
            areas: pickAreas(5, random),
          }),
        ),
      );
    },
  };
}
export type Understanding = ReturnType<typeof createUnderstanding>;
