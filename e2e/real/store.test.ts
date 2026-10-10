// The run-throughs' store checks catch a store broken on purpose (10, "Run-throughs"): a lesson walked
// through and stored as it should be passes; each thing taken away or changed is named.
import { expect, test } from "bun:test";
import { checkQuestion, examResult, sectionsOf } from "@sprachanker/engine";
import type {
  Exam,
  ExamItem,
  ExamPlan,
  Lesson,
  LocaleLesson,
  TypedEvent,
} from "@sprachanker/schema";
import {
  type EventRow,
  examProblems,
  lessonProblems,
  type Stored,
  storeProblems,
} from "./store.ts";

const KEY = "x.y/c/00-01";
const ITEM = `${KEY}/ex-01#1`;
const lesson = {
  key: KEY,
  vocab: [{ key: `${KEY}/v-hallo`, lexeme: "lex:de:hallo:word" }],
  pages: [
    {
      exercise: {
        key: `${KEY}/ex-01`,
        type: "single_choice",
        ruleIds: [],
        items: [
          {
            key: ITEM,
            options: [
              { id: "a", text: "ja" },
              { id: "b", text: "nein" },
            ],
            answer: { optionIds: ["a"] },
          },
        ],
      },
    },
  ],
} as unknown as Lesson;
const locale = {
  tabs: { grammar: [{ bodyHtml: "<p>x</p>" }], culture: [] },
} as unknown as LocaleLesson;

const event = (type: string, payload: unknown, extra: Partial<EventRow> = {}): EventRow => ({
  run_id: "R",
  type,
  item_key: null,
  card_id: null,
  payload_json: JSON.stringify(payload),
  ...extra,
});

/** A Good on a new card's recognition face, due at `due`. */
const review = (due: number) => ({
  face: "recognition",
  rating: 3,
  stateBefore: null,
  stateAfter: {
    due,
    stability: 2,
    difficulty: 2,
    scheduledDays: 0,
    learningSteps: 1,
    reps: 1,
    lapses: 0,
    state: 1,
  },
});

const whole = (): Stored => ({
  runs: [
    { id: "R", kind: "lesson", context_key: KEY, status: "finished", end_reason: "completed" },
    { id: "RV", kind: "review", context_key: null, status: "active", end_reason: null },
  ],
  events: [
    event("step_done", { step: "words" }),
    event("step_done", { step: "grammar:0" }),
    event("page_shown", { pageIndex: 0 }),
    event(
      "answered",
      {
        answer: { optionId: "b" },
        attempt: 1,
        ms: 1,
        outcome: { result: "wrong", score: 0 },
      },
      { item_key: ITEM },
    ),
    event("card_review", review(9), { card_id: "C1", run_id: "RV" }),
  ],
  cards: [{ id: "C1", lexeme_key: "lex:de:hallo:word" }],
});
const check = (stored: Stored) =>
  lessonProblems(stored, lesson, locale, "de", { rated: 1, finished: true });

test("stored as it should be: no problems", () => {
  expect(check(whole())).toEqual([]);
});

test("each thing broken is named", () => {
  const broken = (change: (s: Stored) => void) => {
    const s = whole();
    change(s);
    return check(s).join("\n");
  };
  expect(
    broken((s) => (s.runs[0] = { ...s.runs[0], status: "active" } as Stored["runs"][0])),
  ).toContain("not finished/completed");
  expect(broken((s) => (s.events = s.events.filter((e) => e.type !== "page_shown")))).toContain(
    "never shown",
  );
  expect(broken((s) => (s.events = s.events.filter((e) => e.type !== "answered")))).toContain(
    "neither answered nor skipped",
  );
  expect(
    broken((s) => {
      const a = s.events.find((e) => e.type === "answered") as EventRow;
      a.payload_json = a.payload_json.replace('"wrong"', '"correct"');
    }),
  ).toContain("the engine says wrong");
  expect(broken((s) => (s.events = s.events.filter((e) => e.type !== "step_done")))).toContain(
    "step words not recorded",
  );
  expect(broken((s) => (s.cards = []))).toContain("0 cards for the lesson's 1 words");
  expect(broken((s) => (s.events = s.events.filter((e) => e.type !== "card_review")))).toContain(
    "0 card reviews stored for 1 given",
  );
});

test("the store as a whole: an event its schema refuses, answers numbered twice, a face left behind", () => {
  const s = whole();
  expect(storeProblems(s)).toEqual([]);
  const bad = whole();
  bad.events.push(
    event(
      "answered",
      { answer: { optionId: "a" }, attempt: 1, ms: 1, outcome: { result: "correct", score: 1 } },
      { item_key: ITEM },
    ),
    event("page_shown", { pageIndex: "one" }),
    event("answered", { attempt: 1 }, { run_id: "GONE", item_key: "x" }),
  );
  bad.cards = [{ id: "C1", lexeme_key: "lex:de:hallo:word", faces: "recognition,production" }];
  bad.cardState = [
    { card_id: "C1", face: "recognition", fsrs_json: "{}", due_at: 5 },
    { card_id: "C1", face: "listening", fsrs_json: "{}", due_at: 5 },
  ];
  bad.events.push(
    event(
      "card_review",
      { face: "recognition", rating: 3, stateBefore: null, stateAfter: { due: 9 } },
      { card_id: "C1" },
    ),
  );
  const found = storeProblems(bad).join("\n");
  expect(found).toContain("attempts numbered 1, 1");
  expect(found).toContain("a page_shown event");
  expect(found).toContain("of no run (GONE)");
  expect(found).toContain("a state of listening, not one of its faces");
  expect(found).toContain("due 5, its latest review says 9");
});

// An exam of three general questions (two drawn) and one of each of two states (one drawn).
const EX = "x.y/c/exam-t";
const question = (id: string, state: string | null): ExamItem =>
  ({
    key: `${EX}/q-${id}`,
    type: "single_choice",
    prompt: `Frage ${id}`,
    options: [
      { id: "a", text: "ja" },
      { id: "b", text: "nein" },
    ],
    answer: { optionIds: ["a"] },
    tags: { federalState: state },
  }) as unknown as ExamItem;
const qs = [
  question("1", null),
  question("2", null),
  question("3", null),
  question("be", "be"),
  question("by", "by"),
];
const exam = {
  key: EX,
  timeLimitSec: 600,
  sections: [
    { key: `${EX}/s-general`, pool: qs.slice(0, 3).map((q) => q.key), draw: 2 },
    {
      key: `${EX}/s-state`,
      pool: qs.slice(3).map((q) => q.key),
      draw: 1,
      filter: { tag: "federalState", setting: "exam.federalState" },
    },
  ],
  items: qs,
  thresholds: [{ id: "pass", minPoints: 2 }],
} as unknown as Exam;

/** A mock exam of questions 1, 2 and Berlin's, answered right, wrong, right; and a practice of every
 *  open question with one answer — both ended, each with its result. */
function examStore(): Stored {
  const testItems = [qs[0], qs[1], qs[3]].map((q) => (q as ExamItem).key);
  const testPlan: ExamPlan = {
    mode: "test",
    items: testItems,
    sections: sectionsOf(exam, testItems),
    deadline: 600_000,
    snapshot: [qs[0], qs[1], qs[3]] as ExamItem[],
  };
  const practiceItems = [qs[3], qs[2], qs[1], qs[0]].map((q) => (q as ExamItem).key);
  const practicePlan: ExamPlan = {
    mode: "practice",
    items: practiceItems,
    sections: sectionsOf(exam, practiceItems),
    deadline: null,
  };
  const answer = (run: string, q: ExamItem, optionId: string, ts: number): EventRow => ({
    id: `${run}-${ts}`,
    ts,
    run_id: run,
    type: "answered",
    item_key: q.key,
    card_id: null,
    payload_json: JSON.stringify({
      answer: { optionId },
      attempt: 1,
      ms: 1,
      outcome: checkQuestion(q, { optionId }, "de"),
    }),
  });
  const events = [
    answer("T", qs[0] as ExamItem, "a", 1),
    answer("T", qs[1] as ExamItem, "b", 2),
    answer("T", qs[3] as ExamItem, "a", 3),
    answer("P", qs[2] as ExamItem, "b", 4),
  ];
  const typed = (run: string) =>
    events
      .filter((e) => e.run_id === run)
      .map(
        (e) =>
          ({
            ...e,
            runId: run,
            itemKey: e.item_key,
            payload: JSON.parse(e.payload_json),
          }) as unknown as TypedEvent,
      );
  const practiceScored = { ...practicePlan, items: [(qs[2] as ExamItem).key] };
  return {
    runs: [
      {
        id: "T",
        kind: "exam",
        context_key: EX,
        status: "finished",
        end_reason: "completed",
        finished_at: 10,
        plan_json: JSON.stringify(testPlan),
        result_json: JSON.stringify(examResult(exam, testPlan, typed("T"))),
      },
      {
        id: "P",
        kind: "exam",
        context_key: EX,
        status: "finished",
        end_reason: "completed",
        finished_at: 20,
        plan_json: JSON.stringify(practicePlan),
        result_json: JSON.stringify(examResult(exam, practiceScored, typed("P"))),
      },
    ],
    events,
    cards: [],
  };
}
const TAKEN = { state: "be", tests: 1, practices: 1 };

test("an exam taken and stored as it should be: no problems", () => {
  expect(examProblems(examStore(), exam, "de", TAKEN)).toEqual([]);
  expect(storeProblems(examStore())).toEqual([]);
});

test("each thing broken in an exam's runs is named", () => {
  const broken = (change: (s: Stored) => void) => {
    const s = examStore();
    change(s);
    return examProblems(s, exam, "de", TAKEN);
  };
  const plan = (s: Stored, id: string) =>
    JSON.parse(s.runs.find((r) => r.id === id)?.plan_json ?? "{}");
  const setPlan = (s: Stored, id: string, p: unknown) => {
    (s.runs.find((r) => r.id === id) as { plan_json: string }).plan_json = JSON.stringify(p);
  };
  // Bavaria's question drawn for a learner in Berlin.
  expect(
    broken((s) => {
      const p = plan(s, "T");
      p.items[2] = (qs[4] as ExamItem).key;
      p.sections = sectionsOf(exam, p.items);
      p.snapshot[2] = qs[4];
      setPlan(s, "T", p);
    }),
  ).toContain(`mock exam T: 0 of ${EX}/s-state, not 1`);
  // The questions shown not kept.
  expect(
    broken((s) => {
      const p = plan(s, "T");
      delete p.snapshot;
      setPlan(s, "T", p);
    }),
  ).toContain("mock exam T: its questions not kept as shown");
  // An answer to a question the run did not ask.
  expect(
    broken((s) => {
      (s.events[3] as EventRow).run_id = "T";
    }),
  ).toContain(`run T: an answer to ${EX}/q-3, not one of its questions`);
  // An outcome that is not the engine's.
  expect(
    broken((s) => {
      const e = s.events[1] as EventRow;
      const p = JSON.parse(e.payload_json);
      p.outcome = { result: "correct", score: 1 };
      e.payload_json = JSON.stringify(p);
    }),
  ).toContain(`${EX}/q-2: stored correct, the engine says wrong`);
  // A result its answers do not give.
  expect(
    broken((s) => {
      const r = s.runs[0] as { result_json: string };
      r.result_json = JSON.stringify({ ...JSON.parse(r.result_json), points: 3 });
    }),
  ).toContain("run T: its result is not what its answers give");
  // A mock exam not handed in.
  expect(
    broken((s) => {
      Object.assign(s.runs[0] as object, { status: "active", end_reason: null, finished_at: null });
    }),
  ).toContain("0 mock exams handed in, not 1");
  // Two runs of the exam active at once.
  const twice = examStore();
  for (const r of twice.runs) Object.assign(r, { status: "active", end_reason: null });
  expect(storeProblems(twice)).toContain(`2 active runs of ${EX}`);
});
