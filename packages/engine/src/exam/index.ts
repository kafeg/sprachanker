// Exams: which questions a learner is asked — drawn from each section's pool as the
// real test draws them, a filtered section only from the questions of the learner's setting (their
// federal state) — how a mock exam is scored (each question's latest answer), and what the learner's
// answers across runs say of each question (known, answered wrongly, not seen). Pure: the caller
// gives the settings, the randomness and the events.
import {
  type AnsweredPayload,
  type Exam,
  type ExamItem,
  type ExamItemKey,
  type ExamPlan,
  type ExamResult,
  type ExamSectionKey,
  type Outcome,
  questionExercise,
  type TypedEvent,
} from "@sprachanker/schema";
import { checkItem } from "../check/index.ts";

/** A profile setting's value by key (unset: undefined). */
type SettingOf = (key: string) => string | undefined;

/** The settings as an exam reads them (`get`: a setting's stored value): a text, else unset. */
export const examSettings =
  (get: (key: string) => unknown): SettingOf =>
  (key) => {
    const value = get(key);
    return typeof value === "string" ? value : undefined;
  };

/** The settings an exam needs before it can be drawn (a filtered section's setting unset). */
export const missingSettings = (exam: Exam, setting: SettingOf): string[] => [
  ...new Set(
    exam.sections.flatMap((s) =>
      s.filter && !setting(s.filter.setting) ? [s.filter.setting] : [],
    ),
  ),
];

/** Whether a run's result passes the exam: by its rule where it says (`pass`); none when no pass mark
 *  judges it (a module taken alone without one of its own); else any pass mark reached (results
 *  stored before the rule was kept). */
export const examPassed = (
  result: Pick<ExamResult, "pass" | "passed" | "modules"> | null | undefined,
): boolean | undefined => {
  if (!result) return undefined;
  if (result.pass !== undefined) return result.pass;
  return result.modules ? undefined : result.passed.length > 0;
};

/** A run's points as shown: a mock exam's on the exam's own scale (`score`: with modules, theirs
 *  scaled — Goethe A1 out of 99.6 —; a result kept before it, its questions' points), practice's
 *  its questions' points. */
export const examScore = (
  result: Pick<ExamResult, "points" | "max" | "score">,
  mode: "test" | "practice",
): { points: number; max: number } =>
  (mode === "test" && result.score) || { points: result.points, max: result.max };

/** Each section's questions open to this learner — of one module when it is given: its pool,
 *  filtered by its tag where it has one. */
export function eligible(exam: Exam, setting: SettingOf, module?: string) {
  const items = new Map(exam.items.map((i) => [i.key as string, i]));
  const sections = module ? exam.sections.filter((s) => s.module === module) : exam.sections;
  return sections.map((section) => {
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

/** The questions open to this learner in the sections' order — of one module when it is given. */
export const openQuestions = (exam: Exam, setting: SettingOf, module?: string): ExamItem[] =>
  eligible(exam, setting, module).flatMap(({ pool }) => pool);

/** The questions open to the learner told apart: `general` of every learner, `chosen` those the
 *  setting picks (a federal state's), and — the setting unset — how many choosing it adds (`more`:
 *  the most any value has). Leben in Deutschland: 300 + 10. */
export function openCounts(exam: Exam, setting: SettingOf) {
  const out = { general: 0, chosen: 0, more: 0, filtered: false };
  for (const { section, pool } of eligible(exam, setting)) {
    if (!section.filter) {
      out.general += pool.length;
      continue;
    }
    out.filtered = true;
    if (setting(section.filter.setting) !== undefined) {
      out.chosen += pool.length;
      continue;
    }
    const tag = section.filter.tag;
    const byValue = new Map<string, number>();
    for (const item of exam.items)
      if (section.pool.includes(item.key) && item.tags[tag])
        byValue.set(item.tags[tag], (byValue.get(item.tags[tag]) ?? 0) + 1);
    out.more += Math.max(0, ...byValue.values());
  }
  return out;
}

/** A question's line in a list: what it asks (a gap's text with "…", else its own text's first
 *  line), else its Teil's (a speaking part's: its cards' first lines — "Was machen Sie mit Ihrem
 *  Geld?" —, else its text's); empty when neither has any. */
/** A criterion the learner rates themselves, never the assistant (owner, 2026-10-12): pronunciation
 *  — what the recogniser heard says nothing of it; the learner rates it from their takes. Goethe names
 *  it `aussprache`. */
export const selfRated = (criterion: { id: string }) => criterion.id === "aussprache";

/** A writing task's content points: the lines of its instructions marked as points ("• Bedanken Sie
 *  sich …"), in order. */
export const contentPoints = (instructions: string | undefined): string[] =>
  (instructions ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[•·▪\-–]\s+/.test(l))
    .map((l) => l.replace(/^[•·▪\-–]\s+/, ""));

export const questionLine = (item: ExamItem, section?: Exam["sections"][number]) =>
  item.prompt ||
  (item.type === "gap_text"
    ? item.segments.map((p) => (typeof p === "string" ? p : "…")).join("")
    : "") ||
  item.text?.split("\n")[0] ||
  (section?.letters ?? []).flatMap((l) => l.text?.split("\n")[0]?.trim() || []).join(" · ") ||
  section?.text?.split("\n")[0] ||
  "";

/** `n` of `list` at random (a partial Fisher–Yates shuffle), in the order drawn. */
function pick<T>(list: T[], n: number, random: () => number): T[] {
  const copy = [...list];
  for (let i = 0; i < Math.min(n, copy.length); i++) {
    const j = i + Math.floor(random() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy.slice(0, n);
}

/** A mock exam's questions — of one module when it is given: each section's draw from its open
 *  pool, sections in order; a section asking all its pool asks it in its order (a Teil). Throws when
 *  a setting it needs is unset. */
export function drawExam(
  exam: Exam,
  setting: SettingOf,
  random: () => number,
  module?: string,
): ExamItemKey[] {
  const missing = missingSettings(exam, setting);
  if (missing.length) throw new Error(`the exam needs ${missing.join(", ")}`);
  return eligible(exam, setting, module).flatMap(({ section, pool }) =>
    (section.draw >= pool.length ? pool : pick(pool, section.draw, random)).map((i) => i.key),
  );
}

/** The time a mock exam has: its module's, or the whole exam's. */
export const timeOf = (exam: Exam, module?: string) =>
  exam.modules?.find((m) => m.id === module)?.timeLimitSec ?? exam.timeLimitSec;

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
interface QuestionStat {
  last: "right" | "wrong";
  right: number;
  wrong: number;
}

const right = (outcome: Outcome) => outcome.result === "correct";

/** Each question's stat over the answers given in exam runs (oldest first: the latest counts); an
 *  open answer no check scored says nothing of it. */
export function questionStats(events: TypedEvent[]): Map<string, QuestionStat> {
  const out = new Map<string, QuestionStat>();
  for (const e of events) {
    if (e.type !== "answered" || !e.itemKey || e.payload.outcome.result === "unscored") continue;
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
  module?: string,
): ExamItemKey[] {
  const open = openQuestions(exam, setting, module);
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
  const open = openQuestions(exam, setting);
  if (!open.length) return 0;
  return open.filter((i) => stats.get(i.key)?.last === "right").length / open.length;
}

/** An exam question checked as the item of its kind it is, in the language the exam is in. */
export function checkQuestion(item: ExamItem, answer: unknown, lang: string): Outcome {
  return checkItem(questionExercise(item), 0, answer, lang);
}

/** The pass marks a run can be judged by: with modules, those over modules it took (a module
 *  taken alone is judged by its own). */
export function marksOf(exam: Exam, modules: string[]) {
  if (!exam.modules) return exam.thresholds;
  return exam.thresholds.filter((t) =>
    (t.modules ?? exam.modules?.map((m) => m.id) ?? []).every((m) => modules.includes(m)),
  );
}

/** A pass mark's modules (none: all taken); `{}` is the whole result. */
type MarkOver = { modules?: readonly string[] };

/** The most a pass mark's points can be in a run's result: its modules' scaled points (a module
 *  not scaled: its points), or the questions' points without modules. */
export function markMax(exam: Exam, mark: MarkOver, result: Pick<ExamResult, "max" | "modules">) {
  if (!exam.modules) return result.max;
  return round2(
    (mark.modules ?? Object.keys(result.modules ?? {})).reduce(
      (n, m) =>
        n + (exam.modules?.find((x) => x.id === m)?.scaleTo ?? result.modules?.[m]?.max ?? 0),
      0,
    ),
  );
}

/** A pass mark's points in a run's result: its modules' scaled points together (rounded to whole
 *  points where the exam rounds the total), or the questions' points without modules. */
export function markPoints(
  exam: Exam,
  mark: MarkOver,
  result: Pick<ExamResult, "points" | "modules">,
) {
  if (!exam.modules) return result.points;
  const sum = (mark.modules ?? Object.keys(result.modules ?? {})).reduce(
    (n, m) => n + (result.modules?.[m]?.scaled ?? 0),
    0,
  );
  return exam.roundTotal ? Math.round(sum) : round2(sum);
}

/** A result of an exam of modules on the exam's own scale: its modules' scaled points together, as
 *  its pass marks count them. */
const scaledScore = (exam: Exam, result: Pick<ExamResult, "points" | "max" | "modules">) => ({
  points: markPoints(exam, {}, result),
  max: markMax(exam, {}, result),
});

/** A result as read: one kept before results had their `score`, of an exam of modules, given it
 *  from its modules' points — as `examResult` gives it now — so every view shows one scale. */
export const withScore = (exam: Exam, result: ExamResult): ExamResult =>
  result.score || !result.modules || !exam.modules
    ? result
    : { ...result, score: scaledScore(exam, result) };

/** A run's share of the most it could score (`examScore`): what runs taken over different modules
 *  are compared by. */
export const examShare = (
  result: Pick<ExamResult, "points" | "max" | "score">,
  mode: "test" | "practice",
) => {
  const { points, max } = examScore(result, mode);
  return max ? points / max : 0;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

type Criteria = NonNullable<ExamItem["criteria"]>;

/** The most an open answer's criteria give: each one's best level. */
export const criteriaMax = (criteria: Criteria) =>
  criteria.reduce((n, c) => n + Math.max(...c.levels), 0);

/** Whether ratings give every criterion one of its levels. */
export const ratingsFit = (criteria: Criteria, ratings: Record<string, number>) =>
  criteria.every((c) => c.levels.includes(ratings[c.id] as number)) &&
  Object.keys(ratings).every((id) => criteria.some((c) => c.id === id));

/** The points ratings give an open answer: their sum, 0 when a criterion that voids it is at 0. */
export function ratedPoints(criteria: Criteria, ratings: Record<string, number>) {
  if (criteria.some((c) => c.voids && (ratings[c.id] ?? 0) === 0)) return 0;
  return criteria.reduce((n, c) => n + (ratings[c.id] ?? 0), 0);
}

/**
 * A run's result: each question's latest answer scores its points (its share of them: an open
 * answer's score), by the section the plan keeps for it (in the exam's order of sections) and, with
 * modules, by module, scaled as the exam scales it; the pass marks it can be judged by reached, and
 * whether the exam is passed by its rule (any or all of them).
 */
export function examResult(exam: Exam, plan: ExamPlan, events: TypedEvent[]): ExamResult {
  const latest = new Map<string, AnsweredPayload>();
  const rated = new Map<string, Record<string, number>>();
  for (const e of events) {
    if (e.type === "answered" && e.itemKey) latest.set(e.itemKey, e.payload);
    if (e.type === "exam_rated" && e.itemKey) rated.set(e.itemKey, e.payload.ratings);
  }
  let pending = 0;
  const items = new Map<string, ExamItem>(
    [...exam.items, ...(plan.snapshot ?? [])].map((i) => [i.key, i]),
  );
  const order = exam.sections.map((s) => s.key as string);
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
  const moduleOf = new Map(exam.sections.map((s) => [s.key as string, s.module]));
  const bySection = new Map<string, { points: number; max: number }>();
  const byModule = new Map<string, { points: number; max: number }>();
  const add = (
    map: Map<string, { points: number; max: number }>,
    k: string,
    p: number,
    m: number,
  ) => {
    const t = map.get(k) ?? { points: 0, max: 0 };
    map.set(k, { points: t.points + p, max: t.max + m });
  };
  for (const k of plan.items) {
    const item = items.get(k);
    const criteria = item?.criteria;
    const worth = item?.points ?? (criteria ? criteriaMax(criteria) : 1);
    let got = 0;
    if (criteria) {
      // An open answer scores the levels it was rated at; answered and not rated yet, nothing so far.
      const ratings = rated.get(k);
      if (latest.has(k) && ratings && ratingsFit(criteria, ratings))
        got = (worth * ratedPoints(criteria, ratings)) / criteriaMax(criteria);
      else if (latest.has(k)) pending++;
    } else {
      const outcome = latest.get(k)?.outcome;
      got = outcome && outcome.result !== "unscored" ? worth * outcome.score : 0;
    }
    const section = plan.sections[k] ?? "";
    add(bySection, section, got, worth);
    const module = moduleOf.get(section);
    if (module) add(byModule, module, got, worth);
  }
  const sections: ExamResult["sections"] = {};
  for (const [k, t] of [...bySection].sort(([a], [b]) => rank(a) - rank(b)))
    if (k) sections[k as ExamSectionKey] = { points: round2(t.points), max: t.max };
  const points = round2([...bySection.values()].reduce((n, t) => n + t.points, 0));
  const max = [...bySection.values()].reduce((n, t) => n + t.max, 0);

  const modules: NonNullable<ExamResult["modules"]> = {};
  for (const m of exam.modules ?? []) {
    const t = byModule.get(m.id);
    if (!t) continue;
    const scaled = m.scaleTo && t.max ? (t.points * m.scaleTo) / t.max : t.points;
    modules[m.id] = {
      points: round2(t.points),
      max: t.max,
      scaled: m.round ? Math.round(scaled) : round2(scaled),
    };
  }
  const taken = Object.keys(modules);
  const marks = marksOf(exam, taken);
  const totals = { points, max, modules };
  const passed = marks.filter((t) => markPoints(exam, t, totals) >= t.minPoints).map((t) => t.id);
  return {
    points,
    max,
    answered: plan.items.filter((k) => latest.has(k)).length,
    ...(pending > 0 && { pending }),
    sections,
    ...(exam.modules && { modules, score: scaledScore(exam, totals) }),
    passed,
    // A module taken alone without a pass mark of its own is not judged.
    ...(marks.length > 0 && {
      pass: exam.passWhen === "all" ? passed.length === marks.length : passed.length > 0,
    }),
  };
}
