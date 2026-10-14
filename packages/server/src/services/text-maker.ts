// The text generator (owner, 2026-10-12: every practice text from
// one place). A text of a genre drawn by code is drafted three times side by side
// (`understanding_draft`: the plan — situation, people with gender and age, beats, facts — then the
// text), the drafts rated (`understanding_judge`) and the best that passes kept; none passing, the
// best written again with its problems, twice at most, then kept when nothing in it is plainly
// wrong, else the call fails. Reading's and Listening's texts, the message a writing task answers and
// a role-play's conversation are all made here; what each is for comes as the draft's purpose. More
// than one wanted (a course's practice, owner 2026-10-14): the other drafts that pass come too, best
// first — one round of drafts and rating for several texts.
import {
  chooseDraft,
  type DraftInput,
  type DraftRating,
  LlmError,
  nameWords,
  passable,
  passes,
  pickAreas,
  type TextGenre,
  type TextPurpose,
  totalRating as total,
  type UnderstandingDraft,
  understandingDraftTask,
  understandingJudgeTask,
} from "@sprachanker/llm";
import type { LessonKey } from "@sprachanker/schema";
import type { LessonContexts } from "./lesson-context.ts";
import type { Llm } from "./llm.ts";
import type { RunStore } from "./run-store.ts";
import { verdicts } from "./verdicts.ts";

/** Drafts written for a text (owner, 2026-10-12: always two or three); side by side, but one after
 *  another on this computer's own model (LM Studio answers one at a time). */
export const DRAFTS = 3;
/** How often a draft is written again when none passes. */
const REWRITES = 2;
/** The learner's latest texts of each kind whose people's names a new text avoids. */
const RECENT_TEXTS = 12;

/** What a text is asked for: the lesson in an edition, the learner's language. */
export interface TextRequest {
  series: string;
  lessonKey: LessonKey;
  edition: string;
  language: string;
}

/** Where making a text is: drafts written, the best chosen. */
export type MakingStep = "writing" | "choosing";

export function createTextMaker(deps: {
  store: RunStore;
  llm: Llm;
  lessonContext: LessonContexts;
  random: () => number;
}) {
  const { store, llm, random } = deps;

  /** The lesson as the tasks see it, and the learner's own rules of each task. */
  async function inputs(request: TextRequest) {
    const ctx = await deps.lessonContext.get(request.series, request.lessonKey, request.edition);
    const base = { language: request.language, target: ctx.target, lesson: ctx.info };
    const rules = (task: Parameters<Llm["rulesFor"]>[0]) =>
      llm.rulesFor(task, request.language, ctx.target);
    return { ctx, base, rules };
  }

  /** The names the people of the learner's latest texts (any lesson's) had — Reading's and
   *  Listening's, the messages answered, the role-plays' partners: a new text's are others. */
  function usedNames(): string[] {
    const lesson = { kind: "lesson" } as const;
    const latest = <T extends { ts: number }>(list: T[]) => list.slice(0, RECENT_TEXTS);
    const names = [
      ...latest(verdicts(store, "understanding", lesson)).flatMap((t) =>
        (t.result.people ?? []).map((p) => p.name),
      ),
      ...latest(verdicts(store, "writing_task", lesson)).flatMap((t) =>
        (t.result.message?.lines ?? []).flatMap((l) => (l.speaker ? [l.speaker] : [])),
      ),
      ...latest(verdicts(store, "talk_task", lesson)).flatMap((t) =>
        t.result.kind === "roleplay" ? [t.result.partner.name] : [],
      ),
    ];
    return nameWords(names).slice(0, 30);
  }

  /** Drafts of a genre written and rated: the one kept with its rating, how many drafts there were
   *  and the model; `want` more than one: `more`, the other drafts of the round that pass (best
   *  first, `want - 1` at most). `step` says where it is. */
  async function draft(
    input: Awaited<ReturnType<typeof inputs>>,
    genre: TextGenre,
    step: (now: MakingStep) => void,
    purpose?: TextPurpose,
    want = 1,
  ) {
    const { base, rules } = input;
    const names = usedNames();
    const draftInput = (extra: Partial<DraftInput> = {}): DraftInput => ({
      ...base,
      rules: rules("understandingDraft"),
      genre,
      areas: pickAreas(5, random),
      ...(names.length && { usedNames: names }),
      ...(purpose && { purpose }),
      ...extra,
    });
    const write = (extra?: Partial<DraftInput>) =>
      llm.structured(understandingDraftTask(draftInput(extra)), { timeoutAgain: true });
    const judge = (drafts: UnderstandingDraft[]) =>
      llm.structured(
        understandingJudgeTask({ ...base, rules: rules("understandingJudge"), genre, drafts }),
        { timeoutAgain: true },
      );
    step("writing");
    const local = llm.state().provider === "lmstudio";
    const made: PromiseSettledResult<Awaited<ReturnType<typeof write>>>[] = [];
    if (local) for (let i = 0; i < DRAFTS; i++) made.push(...(await Promise.allSettled([write()])));
    else made.push(...(await Promise.allSettled(Array.from({ length: DRAFTS }, () => write()))));
    const drafts = made.flatMap((m) => (m.status === "fulfilled" ? [m.value.result] : []));
    const model = made.find((m) => m.status === "fulfilled")?.value.model;
    if (!drafts.length || !model) throw (made[0] as PromiseRejectedResult).reason;
    step("choosing");
    const rated = await judge(drafts);
    const { index, again } = chooseDraft(rated.result.ratings);
    const rating = rated.result.ratings.find((r) => r.n === index + 1) as DraftRating;
    const chosen = drafts[index] as UnderstandingDraft;
    const more: Array<{ draft: UnderstandingDraft; rating: DraftRating }> = rated.result.ratings
      .filter(
        (r, i, all) =>
          r.n !== index + 1 &&
          drafts[r.n - 1] &&
          passes(r) &&
          all.findIndex((o) => o.n === r.n) === i,
      )
      .sort((a, b) => total(b) - total(a))
      .slice(0, want - 1)
      .map((r) => ({ draft: drafts[r.n - 1] as UnderstandingDraft, rating: r }));
    if (!again) return { draft: chosen, rating, drafts: drafts.length, model, more };
    // None passed: the best written again with what the judge found, rated alone — twice at most.
    let best = { draft: chosen, rating };
    let count = drafts.length;
    for (let round = 0; round < REWRITES; round++) {
      step("writing");
      const rewritten = await write({
        again: { draft: best.draft, problems: best.rating.problems },
      });
      step("choosing");
      const r = (await judge([rewritten.result])).result.ratings[0] as DraftRating;
      count++;
      if (passes(r)) return { draft: rewritten.result, rating: r, drafts: count, model, more: [] };
      if (total(r) >= total(best.rating)) best = { draft: rewritten.result, rating: r };
    }
    // Still none passing: the best kept when nothing in it is plainly wrong (a text is better than
    // none — the first lessons' few words make a perfect one rare), else nothing.
    if (!passable(best.rating))
      throw new LlmError("invalid_output", `no draft passed (${best.rating.problems.join(" | ")})`);
    return { ...best, drafts: count, model, more: [] };
  }

  return { inputs, draft, random };
}
/** A round's texts kept one by one (`keep`): how many were; one failing leaves the others, all
 *  failing is the first's error. */
export async function keptOf<T>(round: T[], keep: (item: T) => Promise<unknown>) {
  let kept = 0;
  let first: unknown;
  for (const item of round) {
    try {
      await keep(item);
      kept++;
    } catch (error) {
      first ??= error;
      console.warn(`a text of the round not kept: ${(error as Error).message}`);
    }
  }
  if (!kept) throw first;
  return kept;
}

export type TextMaker = ReturnType<typeof createTextMaker>;
export type MakerInputs = Awaited<ReturnType<TextMaker["inputs"]>>;
export type Drafted = Awaited<ReturnType<TextMaker["draft"]>>;
