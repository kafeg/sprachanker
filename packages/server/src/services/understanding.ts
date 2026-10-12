// Reading and Listening (04, "AI practice in courses"; 07): a short text in the language learnt on the
// lesson's topic, made by the text generator — a genre picked by code, drafts written side by side
// (`understanding_draft`), rated (`understanding_judge`) and the best that passes kept (none passing:
// the best written again with its problems, once; still none, nothing is shown), questions asked on
// it (`understanding_questions`) and read again with the text and without it (`understanding_check`)
// so only those the text settles as their key does, and common sense does not, are kept (asked again
// once when fewer than four are). Its people are given the server's voices by gender and age, and a
// text to hear is read aloud ahead into the readings' cache. Kept as an `llm_verdict` (`task:
// understanding`) in the lesson run the lesson shows; each answer a `practice_answered` event on
// it, checked here by the engine, never by a model. The lesson's texts are read across its runs,
// newest first; a text before the two steps counts as Listening's (Reading's when it was to read).
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
  type Run,
  type UnderstandingText,
} from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import { createInFlight } from "./in-flight.ts";
import type { Llm, PromptPreview } from "./llm.ts";
import { HISTORY_LIMIT, type RunStore } from "./run-store.ts";
import type { Drafted, MakerInputs, TextMaker } from "./text-maker.ts";
import {
  keepPracticeAnswer,
  keepVerdict,
  type PracticeAnswer,
  practiceAnswers,
  type Verdict,
  verdicts,
} from "./verdicts.ts";
import { joinWavs } from "./wav.ts";

/** What a text being made is at (09: said beside the time it takes): drafts written, the best
 *  chosen, questions asked, read again. */
export type UnderstandingStep = "writing" | "choosing" | "asking" | "checking";

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
  /** The run the lesson shows (the lessons service). */
  session: (lessonKey: LessonKey) => Promise<{ run: Run } | undefined>;
  llm: Llm;
  /** The text generator: drafts rated, the best kept. */
  maker: TextMaker;
  /** The voices a text's people may be given (none: the server reads nothing aloud). */
  voices?: VoicesFor;
  /** A line read aloud with a voice (the profile's own without one), kept in the readings' cache: read
   *  ahead, and joined into a text's recording. */
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

  /** The genre of a new text: not one of the step's last three in the lesson. */
  function genreFor(
    request: UnderstandingRequest,
    level: string | undefined,
    few: boolean,
  ): TextGenre {
    const recent = texts(request.lessonKey, request.step)
      .slice(0, 3)
      .flatMap((t) => (t.result.genre ? [t.result.genre] : []));
    return pickGenre(request.step, level, recent, random, few);
  }

  const inputs = (request: UnderstandingRequest) => deps.maker.inputs(request);

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

  /** The text's people given the server's voices for the language, by gender and age. */
  function voiced(text: UnderstandingText, lang: string): UnderstandingText {
    const here = deps.voices?.(lang);
    if (!here?.voices.length || !text.people?.length) return text;
    const by = castVoices(here.engine, text.people, here.voices, random);
    return Object.keys(by).length ? { ...text, voices: { engine: here.engine, by } } : text;
  }

  /** Each piece of a text to hear with its voice, as its recording reads it (by the voices its
   *  people have now; a text before its people were known: the profile's own voice). */
  function pieces(id: string, text: UnderstandingText, lang: string) {
    const by = textVoices(id, text.people ?? [], text.voices, deps.voices?.(lang));
    return text.lines.flatMap((l, i) =>
      readingPieces(l.text).map((piece, k, all) => ({
        piece,
        voice: l.speaker ? by[l.speaker] : undefined,
        pauseMs: k < all.length - 1 || i === text.lines.length - 1 ? PAUSE_MS.piece : PAUSE_MS.line,
      })),
    );
  }

  /** A text to hear read aloud ahead, piece by piece, into the readings' cache: its recording is
   *  there when the step opens (errors only logged). */
  async function readAhead(id: string, text: UnderstandingText, lang: string) {
    if (!deps.say || stepOf(text) !== "listening" || !deps.voices?.(lang)) return;
    for (const { piece, voice } of pieces(id, text, lang))
      await deps.say(piece, lang, voice).catch((error: unknown) => {
        console.warn(`reading ahead: ${(error as Error).message}`);
      });
  }

  async function make(request: UnderstandingRequest): Promise<Understood> {
    const session = await deps.session(request.lessonKey);
    if (!session) throw new ServiceError("no_lesson_run", 409);
    const started = now();
    const input = await inputs(request);
    const step = (at: UnderstandingStep) => making.set(key(request.lessonKey, request.step), at);
    const genre = genreFor(request, input.ctx.info.level, fewWords(input.ctx.info));
    const best = await deps.maker.draft(input, genre, step);
    const text = voiced(await askedText(input, request, genre, best, step), input.ctx.target);
    const { verdict } = keepVerdict(store, session.run.id, {
      task: "understanding",
      input: "",
      result: text,
      model: best.model,
      latencyMs: Math.max(0, Math.round(now() - started)),
    });
    void readAhead(verdict.id, text, input.ctx.target);
    return { ...verdict, answers: [] };
  }

  return {
    /** A step's texts of the lesson, newest first, and whether one is being made now, at which
     *  step. */
    state(lessonKey: LessonKey, step: PracticeStep) {
      const at = making.get(key(lessonKey, step)) ?? null;
      return { texts: texts(lessonKey, step).slice(0, HISTORY_LIMIT), preparing: !!at, step: at };
    },

    /** Makes a text for the lesson's step and keeps it in the run the lesson shows. Runs to its end
     *  even when the page that asked is gone. */
    start(request: UnderstandingRequest): Promise<Understood> {
      return making.run(key(request.lessonKey, request.step), "writing", () => make(request));
    },

    /** Makes a text ahead (the lesson started) unless one is being made, or the step's latest is
     *  not answered through yet (untouched or half done: the learner's to finish); its failure only
     *  logged. */
    async prepare(request: UnderstandingRequest) {
      if (making.get(key(request.lessonKey, request.step))) return;
      const latest = texts(request.lessonKey, request.step)[0];
      const answered = (n: number) => !!latest?.answers.some((a) => a.question === n);
      if (latest && understandingStage(latest.result, answered).stage !== "done") return;
      await this.start(request).catch((error: unknown) => {
        console.warn(`${request.step} made ahead: ${(error as Error).message}`);
      });
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

    /** A text's recording: its lines read by its people's voices with pauses between, one WAV (the
     *  server's engine reads the language, else 409). */
    async audio(lessonKey: LessonKey, id: string): Promise<Uint8Array<ArrayBuffer>> {
      const event = store.event(id);
      const run = event && store.get(event.runId, "lesson", lessonKey);
      if (!run?.edition || event?.type !== "llm_verdict" || event.payload.task !== "understanding")
        throw new ServiceError("no_such_item", 404);
      const lang = parseEditionId(run.edition).target;
      const say = deps.say;
      if (!say || !deps.voices?.(lang)) throw new ServiceError("speech_unavailable", 409);
      const parts: Array<{ wav: Uint8Array; pauseMs: number }> = [];
      for (const { piece, voice, pauseMs } of pieces(id, event.payload.result, lang))
        parts.push({ wav: await say(piece, lang, voice), pauseMs });
      const wav = joinWavs(parts);
      if (!wav) throw new ServiceError("speech_unavailable", 409);
      return wav;
    },

    /** The request a draft would send (a genre of the step picked as for a new text). */
    async prompt(request: UnderstandingRequest): Promise<PromptPreview> {
      const input = await inputs(request);
      const genre = genreFor(request, input.ctx.info.level, fewWords(input.ctx.info));
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
