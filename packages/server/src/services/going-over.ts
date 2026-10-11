// Going over mistakes (04, "AI practice in courses"; 07): the mistakes of the pass the lesson shows —
// its items answered wrong at first and its Understanding questions answered wrong — as their wrong
// parts only, grouped by type by the engine (`mistakeGroups`); the model gives each type a short
// explanation and two or three new items of it (`mistake_items`). Kept as an `llm_verdict` (`task:
// mistakes`) in that run; each answer to a new item a `practice_answered` event on it (numbered across
// its groups), checked here by the engine as the item of its type, never by a model. The lesson's
// reviews are read across its runs, newest first.
import {
  checkMistakeItem,
  type MistakeToGoOver,
  mistakeGroups,
  mistakesOf,
  reviewItems,
  understandingMistakes,
} from "@sprachanker/engine";
import {
  type MistakeItemsInput,
  mistakeItemOf,
  mistakeItemsTask,
  structuredRequest,
} from "@sprachanker/llm";
import {
  findExercise,
  type LessonKey,
  type MistakesReview,
  type Outcome,
  parseEditionId,
  type Run,
  type TypedEvent,
} from "@sprachanker/schema";
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

export interface GoingOverRequest {
  series: string;
  lessonKey: LessonKey;
  edition: string;
  language: string;
}

/** An answer to one of a review's new items: the review, the item's number across its groups. */
export interface GoingOverAnswer extends GoingOverRequest {
  id: string;
  question: number;
  answer: unknown;
}

/** A review as the step and the Notebook read it: the verdict with its answers in the order given. */
export type Review = Verdict<"mistakes"> & { answers: PracticeAnswer[] };

export function createGoingOver(deps: {
  store: RunStore;
  /** The run the lesson shows, with its events (the lessons service). */
  session: (lessonKey: LessonKey) => Promise<{ run: Run; events: TypedEvent[] } | undefined>;
  llm: Llm;
  lessonContext: LessonContexts;
}) {
  const { store, llm } = deps;
  /** A review being written, per lesson. */
  const busy = createInFlight<{ preparing: true }>("mistakes_busy");

  /** The lesson's reviews in all its runs, newest first, each with its answers. */
  function reviews(lessonKey: LessonKey): Review[] {
    const where = { kind: "lesson" as const, about: lessonKey };
    const answers = practiceAnswers(store, where);
    return verdicts(store, "mistakes", where).map((v) => ({
      ...v,
      answers: answers.get(v.id) ?? [],
    }));
  }

  /** The pass's mistakes grouped by type, and what the task gets for them. */
  async function inputs(request: GoingOverRequest) {
    const session = await deps.session(request.lessonKey);
    if (!session) throw new ServiceError("no_lesson_run", 409);
    const ctx = await deps.lessonContext.get(request.series, request.lessonKey, request.edition);
    const page = (key: string) => ctx.lesson.pages.findIndex((p) => p.exercise.key === key);
    // The items in the lesson's order, then the Understanding questions.
    const items = mistakesOf([{ events: session.events }])
      .sort((a, b) => page(a.exerciseKey) - page(b.exerciseKey) || a.index - b.index)
      .flatMap((m): MistakeToGoOver[] => {
        const exercise = findExercise(ctx.lesson, m.exerciseKey);
        return exercise
          ? [
              {
                itemKey: m.itemKey,
                exercise,
                locale: ctx.locale?.exercises[exercise.key],
                index: m.index,
                answer: m.answer,
                ...(m.corrected !== undefined && { corrected: m.corrected }),
              },
            ]
          : [];
      });
    const groups = mistakeGroups([...items, ...understandingMistakes(session.events)], ctx.target);
    const input: MistakeItemsInput = {
      language: request.language,
      target: ctx.target,
      rules: llm.rulesFor("mistakes", request.language, ctx.target),
      lesson: ctx.info,
      groups,
    };
    return { run: session.run, input };
  }

  async function write(request: GoingOverRequest): Promise<Review> {
    const { run, input } = await inputs(request);
    if (!input.groups.length) throw new ServiceError("no_mistakes", 409);
    const made = await llm.structured(mistakeItemsTask(input));
    const result: MistakesReview = {
      groups: input.groups.flatMap((g, i) => {
        const reply = made.result.groups.find((r) => r.n === i + 1);
        return reply
          ? [{ ...g, explanation: reply.explanation, items: reply.items.map(mistakeItemOf) }]
          : [];
      }),
    };
    const { verdict } = keepVerdict(store, run.id, {
      task: "mistakes",
      input: "",
      result,
      model: made.model,
      latencyMs: made.latencyMs,
    });
    return { ...verdict, answers: [] };
  }

  return {
    /** The lesson's reviews, newest first, and whether one is being written now. */
    state(lessonKey: LessonKey) {
      return {
        reviews: reviews(lessonKey).slice(0, HISTORY_LIMIT),
        preparing: busy.get(lessonKey) !== undefined,
      };
    },

    /** Goes over the mistakes of the pass the lesson shows and keeps the review in its run; none to
     *  go over: 409 `no_mistakes`. Runs to its end even when the page that asked is gone. */
    start(request: GoingOverRequest): Promise<Review> {
      return busy.run(request.lessonKey, { preparing: true }, () => write(request));
    },

    /** An answer to a review's new item, checked by the engine and kept on the review in its run; an
     *  item answered already keeps its first answer. */
    answer(request: GoingOverAnswer): Review {
      const event = store.event(request.id);
      const run = event && store.get(event.runId, "lesson", request.lessonKey);
      if (!run || event?.type !== "llm_verdict" || event.payload.task !== "mistakes")
        throw new ServiceError("no_such_item", 404);
      const at = reviewItems(event.payload.result)[request.question];
      if (!at) throw new ServiceError("no_such_item", 404);
      const lang = parseEditionId(run.edition ?? request.edition).target;
      let outcome: Outcome;
      try {
        outcome = checkMistakeItem(at.type, at.item, request.answer, lang);
      } catch {
        throw new ServiceError("answer_does_not_fit");
      }
      keepPracticeAnswer(store, run.id, {
        verdict: request.id,
        question: request.question,
        answer: request.answer,
        outcome,
      });
      return reviews(request.lessonKey).find((r) => r.id === request.id) as Review;
    },

    async prompt(request: GoingOverRequest): Promise<PromptPreview> {
      const { input } = await inputs(request);
      if (!input.groups.length) throw new ServiceError("no_mistakes", 409);
      return llm.preview(structuredRequest(mistakeItemsTask(input)));
    },
  };
}
export type GoingOver = ReturnType<typeof createGoingOver>;
