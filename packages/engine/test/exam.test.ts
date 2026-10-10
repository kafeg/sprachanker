import { expect, test } from "bun:test";
import {
  type Exam,
  type ExamItem,
  type ExamPlan,
  examItemKey,
  examKey,
  examSectionKey,
  type TypedEvent,
} from "@sprachanker/schema";
import {
  checkQuestion,
  drawExam,
  eligible,
  examPassed,
  examResult,
  markMax,
  marksOf,
  missingSettings,
  practiceOrder,
  questionStats,
  readiness,
  sectionsOf,
  timeOf,
} from "../src/exam/index.ts";

const EXAM = examKey("bamf.lid/lid" as never, "test");
const q = (id: string, state: string | null, right = "a"): ExamItem => ({
  key: examItemKey(EXAM, id),
  type: "single_choice",
  tags: { federalState: state },
  prompt: `Frage ${id}?`,
  options: [
    { id: "a", text: "ja" },
    { id: "b", text: "nein" },
  ],
  answer: { optionIds: [right] },
});
const general = ["001", "002", "003", "004"].map((id) => q(id, null));
const states = [q("be-01", "be"), q("be-02", "be"), q("by-01", "by")];
const exam: Exam = {
  format: 1,
  key: EXAM,
  timeLimitSec: 3600,
  sections: [
    {
      key: examSectionKey(EXAM, "general"),
      pool: general.map((i) => i.key),
      draw: 3,
      filter: null,
    },
    {
      key: examSectionKey(EXAM, "state"),
      pool: states.map((i) => i.key),
      draw: 1,
      filter: { tag: "federalState", setting: "exam.federalState" },
    },
  ],
  items: [...general, ...states],
  thresholds: [
    { id: "lid", minPoints: 2 },
    { id: "naturalisation", minPoints: 4 },
  ],
};
const berlin = (key: string) => (key === "exam.federalState" ? "be" : undefined);
/** A sequence of "random" numbers, repeated. */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length] as number;
};
const id = (key: string) => key.split("/q-")[1];

let n = 0;
const answered = (item: ExamItem, optionId: string, runId = "run"): TypedEvent =>
  ({
    id: `e${n++}`,
    runId,
    ts: n,
    type: "answered",
    itemKey: item.key,
    cardId: null,
    payload: {
      answer: { optionId },
      attempt: 1,
      ms: 1,
      outcome: checkQuestion(item, { optionId }, "de"),
    },
  }) as TypedEvent;

test("a filtered section is open only with its setting: the state's questions, none drawn without it", () => {
  expect(missingSettings(exam, () => undefined)).toEqual(["exam.federalState"]);
  expect(missingSettings(exam, berlin)).toEqual([]);
  expect(eligible(exam, berlin).map(({ pool }) => pool.map((i) => id(i.key)))).toEqual([
    ["001", "002", "003", "004"],
    ["be-01", "be-02"],
  ]);
  expect(() => drawExam(exam, () => undefined, Math.random)).toThrow(/exam.federalState/);
});

test("a mock exam draws each section's number from its open pool, in section order, at random", () => {
  const drawn = drawExam(exam, berlin, seq(0, 0, 0, 0.99));
  expect(drawn.map(id)).toEqual(["001", "002", "003", "be-02"]);
  const other = drawExam(exam, berlin, seq(0.99, 0.99, 0.99, 0));
  expect(other.map(id)).toEqual(["004", "001", "002", "be-01"]);
  expect(new Set(drawExam(exam, berlin, Math.random)).size).toBe(4);
});

test("a question is checked as a single-choice item", () => {
  expect(checkQuestion(q("001", null, "b"), { optionId: "b" }, "de").result).toBe("correct");
  expect(checkQuestion(q("001", null, "b"), { optionId: "a" }, "de").result).toBe("wrong");
});

test("a result counts each question's latest answer, by section, and the pass marks reached", () => {
  const items = [general[0], general[1], general[2], states[0]].map((i) => (i as ExamItem).key);
  const plan: ExamPlan = { mode: "test", items, sections: sectionsOf(exam, items), deadline: null };
  const events = [
    answered(general[0] as ExamItem, "b"),
    // Changed before handing in: the latest answer counts.
    answered(general[0] as ExamItem, "a"),
    answered(general[1] as ExamItem, "b"),
    answered(states[0] as ExamItem, "a"),
    // A question not asked in this run does not count.
    answered(general[3] as ExamItem, "a"),
  ];
  expect(examResult(exam, plan, events)).toEqual({
    points: 2,
    max: 4,
    answered: 3,
    sections: {
      [examSectionKey(EXAM, "general")]: { points: 1, max: 3 },
      [examSectionKey(EXAM, "state")]: { points: 1, max: 1 },
    },
    passed: ["lid"],
    pass: true,
  });
  // Scored by the sections the plan keeps: a catalogue changed since (a question gone from its pool)
  // leaves the result as it was.
  const changed = {
    ...exam,
    sections: exam.sections.map((s) => ({ ...s, pool: s.pool.filter((k) => k !== items[1]) })),
  };
  expect(examResult(changed, plan, events)).toEqual(examResult(exam, plan, events));
});

test("the answers across runs make each question known, answered wrongly or not seen", () => {
  const stats = questionStats([
    answered(general[0] as ExamItem, "a", "r1"),
    answered(general[1] as ExamItem, "a", "r1"),
    answered(general[1] as ExamItem, "b", "r2"),
    answered(states[0] as ExamItem, "a", "r2"),
  ]);
  expect(stats.get((general[0] as ExamItem).key)).toEqual({ last: "right", right: 1, wrong: 0 });
  expect(stats.get((general[1] as ExamItem).key)).toEqual({ last: "wrong", right: 1, wrong: 1 });
  // Known: 001 and be-01 of the six questions open to a learner in Berlin.
  expect(readiness(exam, berlin, stats)).toBeCloseTo(2 / 6);
  // Practice: the wrong one first, then those not seen, the known ones last.
  const order = practiceOrder(exam, berlin, stats, seq(0)).map(id);
  expect(order[0]).toBe("002");
  expect(order.slice(1, 4).sort()).toEqual(["003", "004", "be-02"]);
  expect(order.slice(4).sort()).toEqual(["001", "be-01"]);
});

// A language exam: Hören (two questions, 15 → 25 points... here 2 → 25) and Lesen (a choice worth 1
// and a typed gap worth 2), each Teil asked whole; passed only with 20 overall and 10 in Hören.
const GOETHE = examKey("goethe.de/a1" as never, "modell");
const choice = (id: string, right = "a"): ExamItem => ({
  ...q(id, null, right),
  key: examItemKey(GOETHE, id),
  tags: {},
});
const gap: ExamItem = {
  key: examItemKey(GOETHE, "l2"),
  type: "gap_text",
  tags: {},
  points: 2,
  segments: ["Name: ", { gap: "g1" }],
  answer: { g1: { accepted: ["Eva", "Eva Kranz"] } },
};
const hoeren = [choice("h1"), choice("h2")];
const lesen = [choice("l1"), gap];
type Threshold = Exam["thresholds"][number];
const modell: Exam = {
  format: 1,
  key: GOETHE,
  timeLimitSec: 2700,
  modules: [
    { id: "hoeren", timeLimitSec: 1200, scaleTo: 25 },
    { id: "lesen", timeLimitSec: 1500, scaleTo: 25 },
  ],
  sections: [
    {
      key: examSectionKey(GOETHE, "h1"),
      module: "hoeren",
      pool: hoeren.map((i) => i.key),
      draw: 2,
      filter: null,
      plays: 2,
    },
    {
      key: examSectionKey(GOETHE, "l1"),
      module: "lesen",
      pool: lesen.map((i) => i.key),
      draw: 2,
      filter: null,
    },
  ],
  items: [...hoeren, ...lesen],
  thresholds: [
    { id: "overall", minPoints: 20 },
    { id: "hoeren", minPoints: 10, modules: ["hoeren"] },
  ],
  passWhen: "all",
};

test("a language exam: a module taken alone or the whole, Teile in their order, timed by the module", () => {
  const random = seq(0.99, 0, 0.5);
  expect(drawExam(modell, () => undefined, random)).toEqual(
    [...hoeren, ...lesen].map((i) => i.key),
  );
  expect(drawExam(modell, () => undefined, random, "lesen")).toEqual(lesen.map((i) => i.key));
  expect(timeOf(modell, "lesen")).toBe(1500);
  expect(timeOf(modell)).toBe(2700);
});

test("a language exam's result: points by question, by module scaled, pass marks over modules, all needed", () => {
  const items = [...hoeren, ...lesen].map((i) => i.key);
  const plan: ExamPlan = {
    mode: "test",
    items,
    sections: sectionsOf(modell, items),
    deadline: null,
  };
  const typed = (item: ExamItem, answer: unknown): TypedEvent =>
    ({
      id: `e${n++}`,
      runId: "run",
      ts: n,
      type: "answered",
      itemKey: item.key,
      cardId: null,
      payload: { answer, attempt: 1, ms: 1, outcome: checkQuestion(item, answer, "de") },
    }) as TypedEvent;
  const events = [
    answered(hoeren[0] as ExamItem, "a"),
    answered(hoeren[1] as ExamItem, "b"),
    answered(lesen[0] as ExamItem, "a"),
    typed(gap, { g1: "Eva Kranz" }),
  ];
  const result = examResult(modell, plan, events);
  expect(result).toMatchObject({
    points: 4,
    max: 5,
    modules: {
      hoeren: { points: 1, max: 2, scaled: 12.5 },
      lesen: { points: 3, max: 3, scaled: 25 },
    },
    passed: ["overall", "hoeren"],
    pass: true,
  });
  // Hören alone: judged by its own mark only.
  const alone = examResult(modell, { ...plan, items: items.slice(0, 2), module: "hoeren" }, events);
  expect(marksOf(modell, ["hoeren"]).map((t) => t.id)).toEqual(["hoeren"]);
  expect(alone).toMatchObject({ passed: ["hoeren"], pass: true });
  // What each mark is out of: the scaled points of its modules (all those taken, by default).
  const [overall, own] = modell.thresholds as [Threshold, Threshold];
  expect([markMax(modell, overall, result), markMax(modell, own, result)]).toEqual([50, 25]);
  expect(markMax(modell, overall, alone)).toBe(25);
  // Hören answered wrongly after all: 25 overall reached, 10 in Hören not — so not passed.
  const failed = examResult(modell, plan, [...events, answered(hoeren[0] as ExamItem, "b")]);
  expect(failed.modules?.hoeren?.scaled).toBe(0);
  expect(failed).toMatchObject({ passed: ["overall"], pass: false });
});

test("rounding as the regulations say: each module's result (B1), or the modules' sum (A1)", () => {
  const items = [...hoeren, ...lesen].map((i) => i.key);
  const plan: ExamPlan = {
    mode: "test",
    items,
    sections: sectionsOf(modell, items),
    deadline: null,
  };
  // Hören 1 of 2, Lesen 1 of 3 (the gap wrong): 12.5 and 8.33.
  const events = [answered(hoeren[0] as ExamItem, "a"), answered(lesen[0] as ExamItem, "a")];
  const rounded = {
    ...modell,
    modules: modell.modules?.map((m) => ({ ...m, round: true })),
  };
  expect(examResult(rounded, plan, events).modules).toMatchObject({
    hoeren: { scaled: 13 },
    lesen: { scaled: 8 },
  });
  // 12.5 + 8.33 = 20.83: a mark of 21 is reached only when the sum is rounded.
  const at21 = { ...modell, thresholds: [{ id: "pass", minPoints: 21 }], passWhen: undefined };
  expect(examResult(at21, plan, events).passed).toEqual([]);
  expect(examResult({ ...at21, roundTotal: true }, plan, events).passed).toEqual(["pass"]);
});

test("a run passes by the exam's rule; a module alone without a mark of its own is not judged", () => {
  expect(examPassed({ pass: false, passed: ["overall"] })).toBe(false);
  expect(
    examPassed({ passed: [], modules: { lesen: { points: 2, max: 3, scaled: 16.67 } } }),
  ).toBeUndefined();
  // Results stored before the rule was kept: any pass mark reached.
  expect(examPassed({ passed: ["lid"] })).toBe(true);
  expect(examPassed(null)).toBeUndefined();
});

test("an open answer scores the levels it is rated at: pending until rated, the latest rating, nothing when its task is missed", () => {
  const writing: ExamItem = {
    key: examItemKey(GOETHE, "s2"),
    type: "respond",
    tags: {},
    input: "text",
    reference: [],
    criteria: [
      { id: "task", levels: [3, 1.5, 0], voids: true },
      { id: "form", levels: [1, 0.5, 0] },
    ],
  };
  const exam: Exam = {
    ...modell,
    sections: [
      {
        key: examSectionKey(GOETHE, "s1"),
        module: "lesen",
        pool: [writing.key],
        draw: 1,
        filter: null,
      },
    ],
    items: [writing],
    thresholds: [{ id: "overall", minPoints: 10 }],
  };
  const plan: ExamPlan = {
    mode: "test",
    items: [writing.key],
    sections: sectionsOf(exam, [writing.key]),
    deadline: null,
  };
  const event = (type: string, payload: unknown): TypedEvent =>
    ({
      id: `e${n++}`,
      runId: "run",
      ts: n,
      type,
      itemKey: writing.key,
      cardId: null,
      payload,
    }) as TypedEvent;
  const answer = event("answered", {
    answer: { text: "Liebe Eva, …" },
    attempt: 1,
    ms: 1,
    outcome: checkQuestion(writing, { text: "Liebe Eva, …" }, "de"),
  });
  // Answered, not rated: nothing yet, one pending.
  expect(examResult(exam, plan, [answer])).toMatchObject({ points: 0, max: 4, pending: 1 });
  const rated = (ratings: Record<string, number>) => event("exam_rated", { ratings, by: "self" });
  expect(examResult(exam, plan, [answer, rated({ task: 3, form: 0.5 })])).toMatchObject({
    points: 3.5,
    max: 4,
  });
  expect(examResult(exam, plan, [answer, rated({ task: 3, form: 0.5 })]).pending).toBeUndefined();
  // Rated again: the latest counts; the task missed makes it nothing.
  expect(
    examResult(exam, plan, [answer, rated({ task: 3, form: 0.5 }), rated({ task: 0, form: 1 })])
      .points,
  ).toBe(0);
  // A rating that does not fit the criteria (a level they do not have) does not count.
  expect(examResult(exam, plan, [answer, rated({ task: 2, form: 1 })])).toMatchObject({
    points: 0,
    pending: 1,
  });
});
