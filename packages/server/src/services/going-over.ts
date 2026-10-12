// Going over mistakes (04, "AI practice in courses"; 07): the mistakes of the pass the lesson shows —
// its items answered wrong at first and its Understanding questions answered wrong — as their wrong
// parts only, grouped by type by the engine (`mistakesToGoOver`, `mistakeGroups`); the model gives
// each type gone over, in a call of its own, a short explanation and two or three new items of it
// (`mistake_items`), then answers those items blind (`mistake_items_check`): only the items it
// settles as their keys do are kept, none kept asks the type once more. The types listed only
// (answers said aloud, Understanding's questions) need no call. Kept as an
// `llm_verdict` (`task: mistakes`) in that run; each answer to a new item a `practice_answered` event
// on it (numbered across its groups), checked here by the engine as the item of its type, never by a
// model. The lesson's reviews are read across its runs, newest first.
import {
  checkMistakeItem,
  type MistakeGroupDraft,
  mistakeGroups,
  mistakesToGoOver,
  reviewItems,
} from "@sprachanker/engine";
import {
  CHECKED_TYPES,
  type MistakeGroupInput,
  type MistakeItemsInput,
  mistakeItemOf,
  mistakeItemsCheckTask,
  mistakeItemsTask,
  settledItems,
  structuredRequest,
} from "@sprachanker/llm";
import {
  type LessonKey,
  type MistakeItem,
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

/** What a review being made is at (09: said beside the time it takes): new items made, or tried
 *  blind. */
export type GoingOverStep = "making" | "checking";

/** The step a review shows of its types' own: making while any type's items are made, checking
 *  while any are checked, else making (a type never checked never shows checking). */
export const stepShown = (steps: Array<GoingOverStep | "done">): GoingOverStep =>
  !steps.includes("making") && steps.includes("checking") ? "checking" : "making";

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
  const busy = createInFlight<GoingOverStep>("mistakes_busy");

  /** The lesson's reviews in all its runs, newest first, each with its answers. */
  function reviews(lessonKey: LessonKey): Review[] {
    const where = { kind: "lesson" as const, about: lessonKey };
    const answers = practiceAnswers(store, where);
    return verdicts(store, "mistakes", where).map((v) => ({
      ...v,
      answers: answers.get(v.id) ?? [],
    }));
  }

  /** The pass's mistakes grouped by type (none: 409 `no_mistakes`), and what the task gets for those
   *  gone over with new items. */
  async function inputs(request: GoingOverRequest) {
    const session = await deps.session(request.lessonKey);
    if (!session) throw new ServiceError("no_lesson_run", 409);
    const ctx = await deps.lessonContext.get(request.series, request.lessonKey, request.edition);
    const { groups, more } = mistakeGroups(
      mistakesToGoOver(session.events, ctx.lesson, ctx.locale),
      ctx.target,
    );
    if (!groups.length) throw new ServiceError("no_mistakes", 409);
    const input: MistakeItemsInput = {
      language: request.language,
      target: ctx.target,
      rules: llm.rulesFor("mistakes", request.language, ctx.target),
      lesson: ctx.info,
      groups: groups.filter((g): g is MistakeGroupDraft & MistakeGroupInput => !!g.type),
    };
    return { run: session.run, groups, more, input };
  }

  /** One type gone over, asked on its own: its explanation and the new items the blind try settles
   *  as their keys do (`mistake_items_check`); none settled, asked once more. `step` says which of
   *  the two runs. */
  async function goneOver(
    input: MistakeItemsInput,
    group: MistakeGroupInput,
    step: (now: GoingOverStep | "done") => void,
  ) {
    const { type } = group;
    let latencyMs = 0;
    let made: { explanation: string; items: MistakeItem[]; model: string } | undefined;
    for (let attempt = 0; attempt < 2 && !made?.items.length; attempt++) {
      step("making");
      const reply = await llm.structured(mistakeItemsTask({ ...input, groups: [group] }), {
        timeoutAgain: true,
      });
      latencyMs += reply.latencyMs;
      const [one] = reply.result.groups;
      const items = (one?.items ?? []).map(mistakeItemOf);
      let kept = items;
      if (CHECKED_TYPES.includes(type)) {
        step("checking");
        const tried = await llm.structured(
          mistakeItemsCheckTask({ language: input.language, target: input.target, type, items }),
          { timeoutAgain: true },
        );
        latencyMs += tried.latencyMs;
        kept = settledItems(
          type,
          items,
          tried.result,
          (item, answer) => checkMistakeItem(type, item, answer, input.target).result === "correct",
          group.what,
        );
      }
      made = { explanation: one?.explanation ?? "", items: kept, model: reply.model };
    }
    return { ...(made as NonNullable<typeof made>), latencyMs };
  }

  async function write(request: GoingOverRequest): Promise<Review> {
    const { run, groups, more, input } = await inputs(request);
    // Each type gone over in a call of its own, side by side (one call for all took up to three
    // minutes); only types listed: no call. The step shown: making while any type's items are
    // being made, then checking (stepShown).
    const steps = input.groups.map((): GoingOverStep | "done" => "making");
    const step = (i: number) => (now: GoingOverStep | "done") => {
      steps[i] = now;
      busy.set(request.lessonKey, stepShown(steps));
    };
    const made = await Promise.allSettled(
      input.groups.map((g, i) => goneOver(input, g, step(i)).finally(() => step(i)("done"))),
    );
    const done = made.flatMap((m) => (m.status === "fulfilled" ? [m.value] : []));
    const failed = made.find((m): m is PromiseRejectedResult => m.status === "rejected");
    if (failed && !done.length) throw failed.reason;
    const result: MistakesReview = {
      groups: groups.map((g) => {
        const at = input.groups.indexOf(g as MistakeGroupInput);
        const one = made[at];
        // A type whose call failed keeps its mistakes, without explanation or items.
        return one?.status === "fulfilled"
          ? { ...g, explanation: one.value.explanation, items: one.value.items }
          : { ...g, explanation: "", items: [] };
      }),
      ...(more > 0 && { more }),
    };
    const { verdict } = keepVerdict(store, run.id, {
      task: "mistakes",
      input: "",
      result,
      model: done[0]?.model ?? "",
      latencyMs: Math.max(0, ...done.map((d) => d.latencyMs)),
    });
    return { ...verdict, answers: [] };
  }

  return {
    /** The lesson's reviews, newest first, and whether one is being made now, at which step. */
    state(lessonKey: LessonKey) {
      const step = busy.get(lessonKey) ?? null;
      return { reviews: reviews(lessonKey).slice(0, HISTORY_LIMIT), preparing: !!step, step };
    },

    /** Goes over the mistakes of the pass the lesson shows and keeps the review in its run; none to
     *  go over: 409 `no_mistakes`. Runs to its end even when the page that asked is gone. */
    start(request: GoingOverRequest): Promise<Review> {
      return busy.run(request.lessonKey, "making", () => write(request));
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
      // Each type is asked on its own: the first type's request.
      return llm.preview(
        structuredRequest(mistakeItemsTask({ ...input, groups: input.groups.slice(0, 1) })),
      );
    },
  };
}
export type GoingOver = ReturnType<typeof createGoingOver>;
