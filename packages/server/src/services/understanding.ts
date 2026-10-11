// Understanding (04, "AI practice in courses"; 07): a short text in the language learnt from what the
// learner knows by the lesson, with questions — written by the model (`understanding_text`), read by
// it a second time (`understanding_check`) so only the questions the text settles as their key does
// are kept (written again once when fewer than three are). Kept as an `llm_verdict` (`task:
// understanding`) in the lesson run the lesson shows, as a writing check is; each answer a
// `practice_answered` event on it, checked here by the engine as the item of its kind, never by a
// model. The lesson's texts are read across its runs, newest first.
import { checkUnderstanding } from "@sprachanker/engine";
import {
  LlmError,
  settledQuestions,
  structuredRequest,
  UNDERSTANDING_MIN_QUESTIONS,
  understandingCheckTask,
  understandingTextTask,
} from "@sprachanker/llm";
import { type LessonKey, type Outcome, parseEditionId, type Run } from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import { createInFlight } from "./in-flight.ts";
import type { LessonContexts } from "./lesson-context.ts";
import type { Llm, PromptPreview } from "./llm.ts";
import { HISTORY_LIMIT, type RunStore } from "./run-store.ts";
import {
  keepPracticeAnswer,
  keepVerdict,
  type PracticeAnswer,
  practiceAnswers,
  type Verdict,
  verdicts,
} from "./verdicts.ts";

export interface UnderstandingRequest {
  series: string;
  lessonKey: LessonKey;
  edition: string;
  language: string;
}

/** An answer to one of a text's questions: the verdict that set it, the question's index. */
export interface UnderstandingAnswer extends UnderstandingRequest {
  id: string;
  question: number;
  answer: unknown;
}

/** A text as the step and the Notebook read it: the verdict with its answers in the order given. */
export type Understood = Verdict<"understanding"> & { answers: PracticeAnswer[] };

export function createUnderstanding(deps: {
  store: RunStore;
  /** The run the lesson shows (the lessons service). */
  session: (lessonKey: LessonKey) => Promise<{ run: Run } | undefined>;
  llm: Llm;
  lessonContext: LessonContexts;
}) {
  const { store, llm } = deps;
  /** A text being written, per lesson. */
  const writing = createInFlight<{ preparing: true }>("understanding_busy");

  /** The lesson's texts in all its runs, newest first, each with its answers. */
  function texts(lessonKey: LessonKey): Understood[] {
    const where = { kind: "lesson" as const, about: lessonKey };
    const answers = practiceAnswers(store, where);
    return verdicts(store, "understanding", where).map((v) => ({
      ...v,
      answers: answers.get(v.id) ?? [],
    }));
  }

  async function inputs(request: UnderstandingRequest) {
    const ctx = await deps.lessonContext.get(request.series, request.lessonKey, request.edition);
    const base = { language: request.language, target: ctx.target };
    return {
      target: ctx.target,
      text: {
        ...base,
        rules: llm.rulesFor("understanding", request.language, ctx.target),
        lesson: ctx.info,
      },
      check: { ...base, rules: llm.rulesFor("understandingCheck", request.language, ctx.target) },
    };
  }

  /** A text written and read again: its questions the second reading settles as the key does. */
  async function settledText(input: Awaited<ReturnType<typeof inputs>>) {
    const made = await llm.structured(understandingTextTask(input.text));
    const read = await llm.structured(
      understandingCheckTask({ ...input.check, text: made.result }),
    );
    const typedRight = (q: Parameters<typeof checkUnderstanding>[0], answer: string) =>
      checkUnderstanding(q, { g1: answer }, input.target).result === "correct";
    return {
      text: settledQuestions(made.result, read.result, typedRight),
      model: made.model,
      latencyMs: made.latencyMs + read.latencyMs,
    };
  }

  async function write(request: UnderstandingRequest): Promise<Understood> {
    const session = await deps.session(request.lessonKey);
    if (!session) throw new ServiceError("no_lesson_run", 409);
    const input = await inputs(request);
    let best = await settledText(input);
    // Too few questions settled: written again once, the better of the two kept.
    if (best.text.questions.length < UNDERSTANDING_MIN_QUESTIONS) {
      const again = await settledText(input).catch(() => undefined);
      if (again && again.text.questions.length > best.text.questions.length) best = again;
    }
    if (!best.text.questions.length)
      throw new LlmError("invalid_output", "no question the text settles");
    const { verdict } = keepVerdict(store, session.run.id, {
      task: "understanding",
      input: "",
      result: best.text,
      model: best.model,
      latencyMs: best.latencyMs,
    });
    return { ...verdict, answers: [] };
  }

  return {
    /** The lesson's texts, newest first, and whether one is being written now. */
    state(lessonKey: LessonKey) {
      return {
        texts: texts(lessonKey).slice(0, HISTORY_LIMIT),
        preparing: writing.get(lessonKey) !== undefined,
      };
    },

    /** Writes a text for the lesson and keeps it in the run the lesson shows. Runs to its end even
     *  when the page that asked is gone. */
    start(request: UnderstandingRequest): Promise<Understood> {
      return writing.run(request.lessonKey, { preparing: true }, () => write(request));
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

    async prompt(request: UnderstandingRequest): Promise<PromptPreview> {
      const input = await inputs(request);
      return llm.preview(structuredRequest(understandingTextTask(input.text)));
    },
  };
}
export type Understanding = ReturnType<typeof createUnderstanding>;
