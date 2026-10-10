// Exams (04, "Exams"; 02): which questions a learner is asked — drawn from each section's pool as the
// real test draws them, a filtered section only from the questions of the learner's setting (their
// federal state) — how a mock exam is scored (each question's latest answer), and what the learner's
// answers across runs say of each question (known, answered wrongly, not seen). Pure: the caller
// gives the settings, the randomness and the events.
import type {
  AnsweredPayload,
  Exam,
  ExamItem,
  ExamItemKey,
  ExamPlan,
  ExamResult,
  ExamSectionKey,
  Exercise,
  Outcome,
  TypedEvent,
} from "@sprachanker/schema";
import { checkItem } from "../check/index.ts";

/** A profile setting's value by key (unset: undefined). */
export type SettingOf = (key: string) => string | undefined;

/** The settings an exam needs before it can be drawn (a filtered section's setting unset). */
export const missingSettings = (exam: Exam, setting: SettingOf): string[] => [
  ...new Set(
    exam.sections.flatMap((s) =>
      s.filter && !setting(s.filter.setting) ? [s.filter.setting] : [],
    ),
  ),
];

/** Each section's questions open to this learner: its pool, filtered by its tag where it has one. */
export function eligible(exam: Exam, setting: SettingOf) {
  const items = new Map(exam.items.map((i) => [i.key as string, i]));
  return exam.sections.map((section) => {
    const wanted = section.filter ? setting(section.filter.setting) : undefined;
    const pool = section.pool.flatMap((k) => {
      const item = items.get(k);
      if (!item) return [];
      if (section.filter && item.tags[section.filter.tag] !== wanted) return [];
      return [item];
    });
    return { section, pool };
  });
}

/** `n` of `list` at random (a partial Fisher–Yates shuffle), in the order drawn. */
function pick<T>(list: T[], n: number, random: () => number): T[] {
  const copy = [...list];
  for (let i = 0; i < Math.min(n, copy.length); i++) {
    const j = i + Math.floor(random() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy.slice(0, n);
}

/** A mock exam's questions: each section's draw from its open pool, sections in order. Throws when a
 *  setting it needs is unset. */
export function drawExam(exam: Exam, setting: SettingOf, random: () => number): ExamItemKey[] {
  const missing = missingSettings(exam, setting);
  if (missing.length) throw new Error(`the exam needs ${missing.join(", ")}`);
  return eligible(exam, setting).flatMap(({ section, pool }) =>
    pick(pool, section.draw, random).map((i) => i.key),
  );
}

/** Each question's section: the first whose pool holds it (a run's plan keeps it). */
export function sectionsOf(exam: Exam, keys: ExamItemKey[]): Record<ExamItemKey, ExamSectionKey> {
  const out: Record<string, ExamSectionKey> = {};
  for (const k of keys) {
    const section = exam.sections.find((s) => s.pool.includes(k));
    if (section) out[k] = section.key;
  }
  return out;
}

/** What the learner's answers say of a question: its latest answer right or wrong, and how often. */
export interface QuestionStat {
  last: "right" | "wrong";
  right: number;
  wrong: number;
}

const right = (outcome: Outcome) => outcome.result === "correct";

/** Each question's stat over the answers given in exam runs (oldest first: the latest counts). */
export function questionStats(events: TypedEvent[]): Map<string, QuestionStat> {
  const out = new Map<string, QuestionStat>();
  for (const e of events) {
    if (e.type !== "answered" || !e.itemKey) continue;
    const ok = right(e.payload.outcome);
    const stat = out.get(e.itemKey) ?? { last: "wrong", right: 0, wrong: 0 };
    out.set(e.itemKey, {
      last: ok ? "right" : "wrong",
      right: stat.right + (ok ? 1 : 0),
      wrong: stat.wrong + (ok ? 0 : 1),
    });
  }
  return out;
}

/** Practice's order: the questions answered wrongly last time first, then those not seen, then those
 *  known — each group shuffled. */
export function practiceOrder(
  exam: Exam,
  setting: SettingOf,
  stats: Map<string, QuestionStat>,
  random: () => number,
): ExamItemKey[] {
  const open = eligible(exam, setting).flatMap(({ pool }) => pool);
  const group = (test: (s: QuestionStat | undefined) => boolean) => {
    const keys = open.filter((i) => test(stats.get(i.key))).map((i) => i.key);
    return pick(keys, keys.length, random);
  };
  return [
    ...group((s) => s?.last === "wrong"),
    ...group((s) => s === undefined),
    ...group((s) => s?.last === "right"),
  ];
}

/** How ready the learner is: the share of the questions open to them whose latest answer was right
 *  (0 when none is open). */
export function readiness(exam: Exam, setting: SettingOf, stats: Map<string, QuestionStat>) {
  const open = eligible(exam, setting).flatMap(({ pool }) => pool);
  if (!open.length) return 0;
  return open.filter((i) => stats.get(i.key)?.last === "right").length / open.length;
}

/** An exam question checked as the single-choice item it is (04), in the language the exam is in. */
export function checkQuestion(item: ExamItem, answer: unknown, lang: string): Outcome {
  const asExercise = {
    key: item.key,
    type: "single_choice",
    fingerprint: "",
    newWords: [],
    ruleIds: [],
    items: [item],
  } as unknown as Exercise;
  return checkItem(asExercise, 0, answer, lang);
}

/** A run's result: its questions' points (each question's latest answer), by the section the plan
 *  keeps for each (in the exam's order of sections), and the exam's pass marks reached. */
export function examResult(exam: Exam, plan: ExamPlan, events: TypedEvent[]): ExamResult {
  const latest = new Map<string, AnsweredPayload>();
  for (const e of events) if (e.type === "answered" && e.itemKey) latest.set(e.itemKey, e.payload);
  const order = exam.sections.map((s) => s.key as string);
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
  const tally = new Map<string, { points: number; max: number }>();
  for (const k of plan.items) {
    const section = plan.sections[k] ?? "";
    const t = tally.get(section) ?? { points: 0, max: 0 };
    const answer = latest.get(k);
    t.max += 1;
    if (answer !== undefined && right(answer.outcome)) t.points += 1;
    tally.set(section, t);
  }
  const sections: ExamResult["sections"] = {};
  for (const [k, t] of [...tally].sort(([a], [b]) => rank(a) - rank(b)))
    if (k) sections[k as ExamSectionKey] = t;
  const points = [...tally.values()].reduce((n, t) => n + t.points, 0);
  return {
    points,
    max: plan.items.length,
    answered: plan.items.filter((k) => latest.has(k)).length,
    sections,
    passed: exam.thresholds.filter((t) => points >= t.minPoints).map((t) => t.id),
  };
}
