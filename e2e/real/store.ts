// What a run-through checks in the profile's database after a lesson (10, "Run-throughs"; 05): the
// rows (read by read-store.ts) checked by a pure function, so a store broken on purpose shows that
// the checks catch it (store.test.ts).
import { isDeepStrictEqual } from "node:util";
import {
  checkItem,
  checkQuestion,
  eligible,
  examResult,
  itemScored,
  sectionsOf,
} from "@sprachanker/engine";
import {
  EVENT_PAYLOADS,
  type Exam,
  ExamPlan,
  ExamResult,
  type Lesson,
  type LocaleLesson,
  type TypedEvent,
} from "@sprachanker/schema";

export interface RunRow {
  id: string;
  kind: string;
  context_key: string | null;
  status: string;
  end_reason: string | null;
  finished_at?: number | null;
  plan_json?: string | null;
  result_json?: string | null;
}
export interface EventRow {
  id?: string;
  ts?: number;
  run_id: string;
  type: string;
  item_key: string | null;
  card_id: string | null;
  payload_json: string;
}
export interface CardRow {
  id: string;
  lexeme_key: string | null;
  /** The faces it is studied by, comma-separated. */
  faces?: string;
}
export interface CardStateRow {
  card_id: string;
  face: string;
  fsrs_json: string | null;
  due_at: number | null;
}
export interface Stored {
  runs: RunRow[];
  events: EventRow[];
  cards: CardRow[];
  cardState?: CardStateRow[];
  /** The profile's recordings folder: the files' names. */
  recordings?: string[];
}

/**
 * Problems with the profile's store as a whole, whatever was done (05): every event reads by its
 * type's schema and belongs to a run there, in time order within its run; one active run per lesson; a
 * finished run with its end; one active run per lesson and per exam; an item's answers numbered 1, 2, 3… with none twice; a card's faces
 * only reviewed and kept, each face's state the one its latest review (not taken back) left; a spoken answer's recording on disk.
 */
export function storeProblems(stored: Stored): string[] {
  const problems: string[] = [];
  const runs = new Map(stored.runs.map((r) => [r.id, r]));
  const lastTs = new Map<string, number>();
  for (const e of stored.events) {
    const schema = EVENT_PAYLOADS[e.type as keyof typeof EVENT_PAYLOADS];
    if (!schema) problems.push(`an event of an unknown type ${e.type}`);
    else if (!schema.safeParse(JSON.parse(e.payload_json)).success)
      problems.push(
        `a ${e.type} event (${e.item_key ?? e.card_id ?? e.id}) that its schema refuses`,
      );
    if (!runs.has(e.run_id)) problems.push(`a ${e.type} event of no run (${e.run_id})`);
    if (e.ts !== undefined) {
      if (e.ts < (lastTs.get(e.run_id) ?? 0))
        problems.push(`events of run ${e.run_id} out of order`);
      lastTs.set(e.run_id, e.ts);
    }
  }
  const active = new Map<string, number>();
  for (const r of stored.runs) {
    if ((r.kind === "lesson" || r.kind === "exam") && r.status === "active" && r.context_key)
      active.set(r.context_key, (active.get(r.context_key) ?? 0) + 1);
    if (r.status === "finished" && (!r.end_reason || r.finished_at === null))
      problems.push(`run ${r.id} finished without its end`);
  }
  for (const [key, n] of active) if (n > 1) problems.push(`${n} active runs of ${key}`);

  // An item's answers within a run: numbered from 1 with no gap and none twice.
  const attempts = new Map<string, number[]>();
  for (const e of stored.events)
    if (e.type === "answered" && e.item_key) {
      const k = `${e.run_id} ${e.item_key}`;
      attempts.set(k, [...(attempts.get(k) ?? []), JSON.parse(e.payload_json).attempt as number]);
    }
  for (const [k, list] of attempts)
    if (list.some((n, i) => n !== i + 1))
      problems.push(`${k}: attempts numbered ${list.join(", ")}`);

  // Cards: states and reviews of its faces only (a face's row is made at its first review: a new face
  // has none), each face as its latest review left it.
  if (stored.cardState) {
    const state = new Map(stored.cardState.map((s) => [`${s.card_id} ${s.face}`, s]));
    const faces = new Map(
      stored.cards.map((c) => [c.id, (c.faces ?? "").split(",").filter(Boolean)]),
    );
    for (const s of stored.cardState)
      if (!faces.get(s.card_id)?.includes(s.face))
        problems.push(`card ${s.card_id}: a state of ${s.face}, not one of its faces`);
    const undone = new Set(
      stored.events
        .filter((e) => e.type === "card_undo")
        .map((e) => JSON.parse(e.payload_json).review as string),
    );
    const latest = new Map<string, Record<string, unknown>>();
    for (const e of stored.events)
      if (e.type === "card_review" && e.card_id && !(e.id && undone.has(e.id))) {
        const p = JSON.parse(e.payload_json);
        if (!faces.get(e.card_id)?.includes(p.face))
          problems.push(`card ${e.card_id}: reviewed by ${p.face}, not one of its faces`);
        latest.set(`${e.card_id} ${p.face}`, p.stateAfter);
      }
    for (const [k, after] of latest) {
      const now = state.get(k);
      if (!now) problems.push(`card ${k}: reviewed, with no state`);
      else if (now.due_at !== after.due)
        problems.push(`card ${k}: due ${now.due_at}, its latest review says ${after.due}`);
    }
  }

  // A spoken answer's recording is kept on disk.
  if (stored.recordings) {
    const files = new Set(stored.recordings.map((f) => f.replace(/\.[^.]+$/, "")));
    for (const e of stored.events)
      if (e.type === "answered") {
        const id = JSON.parse(e.payload_json).answer?.recording;
        if (typeof id === "string" && !files.has(id))
          problems.push(`${e.item_key}: its recording ${id} is not on disk`);
      }
  }
  return problems;
}

/** What the run-through did in the lesson, to compare the store with. */
export interface Walked {
  /** Cards rated in the words step. */
  rated: number;
  /** Cards rated in Review after the lesson. */
  reviewed?: number;
  /** The lesson was finished: every step worked, the summary reached. */
  finished: boolean;
}

/**
 * Problems with how a lesson walked through is stored: its one run (finished and completed when the
 * walk finished it), each exercise page shown, every item answered or skipped, each answer's outcome the
 * engine's own for it, the reading steps and the words recorded, the words' cards made and the ratings
 * given to them. Empty when all is as it should be.
 */
export function lessonProblems(
  stored: Stored,
  lesson: Lesson,
  locale: LocaleLesson,
  lang: string,
  walked: Walked,
): string[] {
  const problems: string[] = [];
  const runs = stored.runs.filter((r) => r.kind === "lesson" && r.context_key === lesson.key);
  if (runs.length !== 1) return [`${runs.length} lesson runs for ${lesson.key}, not 1`];
  const run = runs[0] as RunRow;
  if (walked.finished && (run.status !== "finished" || run.end_reason !== "completed"))
    problems.push(`the run is ${run.status}/${run.end_reason}, not finished/completed`);
  const events = stored.events.filter((e) => e.run_id === run.id);
  const payload = (e: EventRow) => JSON.parse(e.payload_json) as Record<string, unknown>;

  lesson.pages.forEach(({ exercise }, page) => {
    if (!events.some((e) => e.type === "page_shown" && payload(e).pageIndex === page))
      problems.push(`page ${page} (${exercise.key}) never shown`);
    exercise.items.forEach((item, i) => {
      const own = events.filter((e) => e.item_key === item.key);
      const answers = own.filter((e) => e.type === "answered");
      if (!answers.length && !own.some((e) => e.type === "item_skipped")) {
        problems.push(`${item.key}: neither answered nor skipped`);
        return;
      }
      for (const a of answers) {
        const { answer, outcome } = payload(a) as { answer: unknown; outcome?: { result: string } };
        if (!outcome) problems.push(`${item.key}: an answer stored without its outcome`);
        else if (itemScored(exercise, i)) {
          const own = checkItem(exercise, i, answer, lang).result;
          if (own !== outcome.result)
            problems.push(`${item.key}: stored ${outcome.result}, the engine says ${own}`);
        }
      }
    });
  });

  const steps = new Set(
    events.filter((e) => e.type === "step_done").map((e) => String(payload(e).step)),
  );
  const reading = [
    ...(lesson.vocab.length ? ["words"] : []),
    ...(locale.tabs.grammar ?? []).map((_, i) => `grammar:${i}`),
    ...(locale.tabs.culture ?? []).map((_, i) => `culture:${i}`),
  ];
  for (const step of reading)
    if (!steps.has(step)) problems.push(`step ${step} not recorded as done or skipped`);

  // The words' cards, one per word (a lexeme), and every rating given to one of them.
  if (walked.rated > 0) {
    const lexemes = new Set(lesson.vocab.map((v) => v.lexeme as string));
    const cards = stored.cards.filter((c) => c.lexeme_key && lexemes.has(c.lexeme_key));
    if (cards.length !== lexemes.size)
      problems.push(`${cards.length} cards for the lesson's ${lexemes.size} words`);
    const ids = new Set(stored.cards.map((c) => c.id));
    const reviews = stored.events.filter((e) => e.type === "card_review");
    const given = walked.rated + (walked.reviewed ?? 0);
    if (reviews.length < given)
      problems.push(`${reviews.length} card reviews stored for ${given} given`);
    if (walked.reviewed && !stored.runs.some((r) => r.kind === "review"))
      problems.push("cards reviewed without a review run");
    for (const r of reviews)
      if (!r.card_id || !ids.has(r.card_id))
        problems.push(`a card review of an unknown card ${r.card_id}`);
  }
  return problems;
}

/** What the run-through did in an exam. */
export interface Taken {
  /** The profile's federal state (the setting the exam's filtered sections read). */
  state: string;
  /** Mock exams handed in, and practice runs ended. */
  tests: number;
  practices: number;
}

/**
 * Problems with how an exam taken is stored (05; 04, "Exams"): each run's plan reads — a mock exam's
 * questions drawn as the real test draws them (each section's number, the state's questions only),
 * kept as shown with their sections and a deadline; practice over every open question with none —;
 * answers only to the run's own questions, each outcome the engine's; a run handed in with the result
 * its answers give; as many mock exams and practices ended as were taken. Empty when all is as it
 * should be.
 */
export function examProblems(stored: Stored, exam: Exam, lang: string, taken: Taken): string[] {
  const problems: string[] = [];
  const setting = (key: string) => (key === "exam.federalState" ? taken.state : undefined);
  const open = eligible(exam, setting);
  const items = new Map(exam.items.map((i) => [i.key as string, i]));
  const runs = stored.runs.filter((r) => r.kind === "exam" && r.context_key === exam.key);
  const ended = { test: 0, practice: 0 };
  for (const run of runs) {
    const plan = ExamPlan.safeParse(JSON.parse(run.plan_json ?? "null"));
    if (!plan.success) {
      problems.push(`run ${run.id}: its plan does not read`);
      continue;
    }
    const { mode, items: asked, sections, deadline, snapshot } = plan.data;
    if (new Set(asked).size !== asked.length)
      problems.push(`run ${run.id}: a question asked twice`);
    for (const k of asked)
      if (!items.has(k)) problems.push(`run ${run.id}: ${k} is no question of the exam`);
    if (!isDeepStrictEqual(sections, sectionsOf(exam, asked)))
      problems.push(`run ${run.id}: its questions' sections are not their own`);
    if (mode === "test") {
      if (deadline === null) problems.push(`mock exam ${run.id} without a deadline`);
      for (const { section, pool } of open) {
        const own = new Set<string>(pool.map((i) => i.key));
        const drawn = asked.filter((k) => own.has(k)).length;
        if (drawn !== section.draw)
          problems.push(`mock exam ${run.id}: ${drawn} of ${section.key}, not ${section.draw}`);
      }
      const others = asked.filter((k) => !open.some(({ pool }) => pool.some((i) => i.key === k)));
      if (others.length)
        problems.push(`mock exam ${run.id}: ${others.join(", ")} not open to the learner`);
      if (
        !isDeepStrictEqual(
          snapshot,
          asked.map((k) => items.get(k)),
        )
      )
        problems.push(`mock exam ${run.id}: its questions not kept as shown`);
    } else {
      if (deadline !== null || snapshot)
        problems.push(`practice ${run.id} with a deadline or snapshot`);
      const all = open.flatMap(({ pool }) => pool.map((i) => i.key as string));
      if ([...asked].sort().join() !== [...all].sort().join())
        problems.push(`practice ${run.id}: not every open question`);
    }

    const answers = stored.events.filter((e) => e.run_id === run.id && e.type === "answered");
    const typed: TypedEvent[] = [];
    for (const a of answers) {
      const p = JSON.parse(a.payload_json);
      const item = a.item_key ? items.get(a.item_key) : undefined;
      if (!item || !asked.includes(item.key)) {
        problems.push(`run ${run.id}: an answer to ${a.item_key}, not one of its questions`);
        continue;
      }
      const own = checkQuestion(item, p.answer, lang).result;
      if (p.outcome?.result !== own)
        problems.push(`${item.key}: stored ${p.outcome?.result}, the engine says ${own}`);
      typed.push({
        id: a.id ?? "",
        runId: run.id,
        ts: a.ts ?? 0,
        type: "answered",
        itemKey: a.item_key,
        cardId: null,
        payload: p,
      } as TypedEvent);
    }
    if (run.status === "finished") {
      ended[mode]++;
      const result = ExamResult.safeParse(JSON.parse(run.result_json ?? "null"));
      const given = new Set(typed.map((e) => e.itemKey));
      const scored =
        mode === "practice"
          ? { ...plan.data, items: asked.filter((k) => given.has(k)) }
          : plan.data;
      if (!result.success) problems.push(`run ${run.id}: handed in without a result that reads`);
      else if (!isDeepStrictEqual(result.data, examResult(exam, scored, typed)))
        problems.push(`run ${run.id}: its result is not what its answers give`);
    }
  }
  if (ended.test !== taken.tests)
    problems.push(`${ended.test} mock exams handed in, not ${taken.tests}`);
  if (ended.practice !== taken.practices)
    problems.push(`${ended.practice} practices ended, not ${taken.practices}`);
  return problems;
}
