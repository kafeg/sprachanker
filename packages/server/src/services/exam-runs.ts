// Taking an exam (04, "Exams"; 05; 09, Exams): its runs — a mock exam drawn as the real test draws
// (timed, its answers checked only when handed in, so nothing gives them away before) or practice
// (each answer checked at once) — started, opened, answered, rated, handed in. Storage goes through
// the run store: a run of kind `exam` about the exam, its plan in `plan_json`, each answer an
// `answered` event on its question, the result in `result_json`. The exams' standings read them:
// exams.ts.
import {
  checkQuestion,
  drawExam,
  examResult,
  missingSettings,
  practiceOrder,
  questionStats,
  ratingsFit,
  sectionsOf,
  settingOf,
  timeOf,
} from "@sprachanker/engine";
import {
  type Exam,
  ExamEventInput,
  type ExamItem,
  type ExamItemKey,
  type ExamKey,
  type ExamMode,
  ExamPlan,
  ExamResult,
  type ExamRun,
  examLang,
  type LocaleExam,
  type Outcome,
  type SettingKey,
  seriesOf,
} from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import { appendAnswers } from "./answers.ts";
import type { Content } from "./content.ts";
import { headerOf, type NewEvent, type RunRow, type RunStore, readStored } from "./run-store.ts";
import type { Settings } from "./settings.ts";

/** Answers a mock exam takes after its time is up: what was on its way when the time ran out. */
const GRACE_MS = 30_000;

/** A random number in [0, 1) from the platform's cryptographic generator (a draw no one foresees;
 *  WebCrypto: the same in every runtime). */
const random = () => (crypto.getRandomValues(new Uint32Array(1))[0] as number) / 2 ** 32;

const toExamRun = (row: RunRow): ExamRun | undefined => {
  const plan = readStored(row.planJson, ExamPlan, `plan of run ${row.id}`);
  if (!plan) return undefined;
  return {
    ...headerOf(row),
    exam: row.contextKey as ExamKey,
    plan,
    result: readStored(row.resultJson, ExamResult, `result of run ${row.id}`) ?? null,
  };
};

export function createExamRuns({
  store,
  content,
  settings,
  now,
}: {
  store: RunStore;
  content: Content;
  settings: Settings;
  now: () => number;
}) {
  const setting = settingOf((key) => settings.get(key as SettingKey));
  /** The exam's run in progress, if any. */
  const activeOf = (exam: ExamKey) => {
    const row = store.active("exam", exam);
    return row ? toExamRun(row) : undefined;
  };
  /** Every answer given in the exam's runs, oldest first — but a running mock exam's: what they say
   *  of its questions shows only once it is handed in. */
  const answersIn = (exam: ExamKey) => {
    const running = activeOf(exam);
    const hidden = running?.plan.mode === "test" ? running.id : undefined;
    return store
      .eventsWhere({ types: ["answered"], kind: "exam", about: exam, ascending: true })
      .filter((e) => e.runId !== hidden);
  };
  /** The exam's runs, newest first, read whole (one whose plan no longer reads is left out). */
  const runsOf = (exam: ExamKey) => store.list("exam", exam).flatMap((row) => toExamRun(row) ?? []);
  /** Every exam's runs, by exam, newest first. */
  const allRuns = () => {
    const byExam = new Map<ExamKey, ExamRun[]>();
    for (const row of store.all("exam")) {
      const run = toExamRun(row);
      if (run) byExam.set(run.exam, [run, ...(byExam.get(run.exam) ?? [])]);
    }
    return byExam;
  };

  const getRun = (runId: string) => {
    const row = store.get(runId, "exam");
    const run = row && toExamRun(row);
    if (!row || !run) throw new ServiceError("no_such_run", 404);
    return { row, run };
  };
  const examOf = async (key: ExamKey) => {
    try {
      return await content.exam(seriesOf(key), key);
    } catch {
      throw new ServiceError("not_installed", 404);
    }
  };
  /** A run's events as the learner may see them: a mock exam still running keeps its outcomes to
   *  itself (they would give the answers away). */
  const shownEvents = (run: ExamRun) => {
    const list = store.events(run.id, ["answered", "exam_rated", "llm_verdict", "llm_turn"]);
    if (run.plan.mode === "practice" || run.status !== "active") return list;
    return list.map((e) => {
      if (e.type !== "answered") return e;
      const { outcome: _, ...payload } = e.payload;
      return { ...e, payload };
    });
  };
  /** An exam's texts in an edition (its title, its modules', sections' and questions' texts), if it
   *  is still installed. */
  const localeOf = (key: ExamKey, edition: string | null): Promise<LocaleExam | undefined> =>
    edition
      ? content.localeExam(seriesOf(key), key, edition).catch(() => undefined)
      : Promise.resolve(undefined);
  /** A question of the run: from its snapshot (a mock exam), else from the exam as installed. */
  const questionOf = (exam: Exam, run: ExamRun, key: string): ExamItem | undefined =>
    run.plan.snapshot?.find((i) => i.key === key) ?? exam.items.find((i) => i.key === key);

  /** A run's result over its answers and ratings: a mock exam over its questions, practice over those
   *  answered. */
  function resultOf(exam: Exam, run: ExamRun) {
    const events = store.events(run.id, ["answered", "exam_rated"]);
    const answered = new Set(
      events.flatMap((e) => (e.type === "answered" && e.itemKey ? [e.itemKey] : [])),
    );
    const plan =
      run.plan.mode === "practice"
        ? { ...run.plan, items: run.plan.items.filter((k) => answered.has(k)) }
        : run.plan;
    return examResult(exam, plan, events);
  }
  /** Ends the run with its result; one handed in after its time ends as `timeout`. */
  async function handIn(runId: string, run: ExamRun) {
    const exam = await examOf(run.exam);
    const late = run.plan.deadline !== null && now() > run.plan.deadline;
    store.end(runId, "finished", late ? "timeout" : "completed", resultOf(exam, run));
  }

  /** A mock exam left running past its time (and the grace for answers on their way) is handed in
   *  as it stands — the learner closed the page, or never came back. */
  async function settle(run: ExamRun | undefined) {
    if (run?.status === "active" && run.plan.deadline !== null)
      if (now() > run.plan.deadline + GRACE_MS) await handIn(run.id, run);
  }

  /**
   * Hands in every mock exam left past its time (06): what reads exam runs — the exams' list and
   * page, a run opened, the Notebook — calls it first, so each reads them handed in. The one write a
   * reading request makes; one of an exam no longer installed stays as it is.
   */
  async function settleOverdue() {
    for (const row of store.all("exam"))
      if (row.status === "active") await settle(toExamRun(row)).catch(() => undefined);
  }

  /** A run in progress with work in it (one only opened is none, as a lesson's). */
  const worked = (run: ExamRun) =>
    run.status === "active" && store.events(run.id, ["answered"]).length > 0;

  /** A run as the player opens it: the run, its answers (a running mock exam's without their
   *  outcomes) and the server's clock, which the countdown keeps to. */
  async function open(runId: string) {
    await settle(getRun(runId).run);
    const { run } = getRun(runId);
    return { run, events: shownEvents(run), now: now() };
  }

  /** An open answer of a run, to be rated: the question (with criteria, in the run's plan) and the
   *  learner's latest answer to it; the run's exam and its locale. */
  async function openAnswer(runId: string, itemKey: string) {
    const { row, run } = getRun(runId);
    if (row.status === "abandoned") throw new ServiceError("run_not_active", 409);
    const exam = await examOf(run.exam);
    const item = run.plan.items.includes(itemKey as ExamItemKey)
      ? questionOf(exam, run, itemKey)
      : undefined;
    if (!item?.criteria) throw new ServiceError("no_such_item");
    const answer = store
      .events(runId, ["answered"])
      .findLast((e) => e.type === "answered" && e.itemKey === itemKey);
    const text =
      answer?.type === "answered" ? (answer.payload.answer as { text?: unknown }).text : undefined;
    if (typeof text !== "string") throw new ServiceError("invalid_request");
    const locale = await localeOf(run.exam, run.edition);
    return { row, run, exam, locale, item: { ...item, criteria: item.criteria }, text };
  }

  /** A speaking part of a run being taken: the question said aloud (in the run's plan), its section
   *  and the exam's locale; refused once the run has ended or its time is up. */
  async function speakingPart(runId: string, itemKey: string) {
    const { row, run } = getRun(runId);
    if (row.status !== "active") throw new ServiceError("run_not_active", 409);
    if (run.plan.deadline !== null && now() > run.plan.deadline)
      throw new ServiceError("exam_time_over", 409);
    const exam = await examOf(run.exam);
    const item = run.plan.items.includes(itemKey as ExamItemKey)
      ? questionOf(exam, run, itemKey)
      : undefined;
    if (item?.type !== "respond" || item.input !== "speech") throw new ServiceError("no_such_item");
    const section = exam.sections.find((s) => s.key === run.plan.sections[item.key]);
    const locale = await localeOf(run.exam, run.edition);
    return { run, exam, locale, item, section };
  }

  return {
    setting,
    activeOf,
    answersIn,
    runsOf,
    allRuns,
    examOf,
    localeOf,
    worked,
    settleOverdue,
    open,
    openAnswer,
    speakingPart,

    /** A run of the exam to take: a new one (`mode`), an active practice ending as abandoned; not
     *  while a mock exam runs (it is handed in, or its time runs out). A mock exam draws its
     *  questions and keeps them as shown; practice orders the open questions, the wrong ones first. */
    async start(key: ExamKey, edition: string, mode: ExamMode, module?: string) {
      const exam = await examOf(key);
      if (module && !exam.modules?.some((m) => m.id === module))
        throw new ServiceError("invalid_request");
      const course = (await content.courses()).find((c) => c.exams.includes(key));
      if (!course?.editions.includes(edition)) throw new ServiceError("not_installed", 404);
      if (missingSettings(exam, setting).length) throw new ServiceError("exam_needs_setting", 409);
      await settle(activeOf(key));
      if (activeOf(key)?.plan.mode === "test") throw new ServiceError("exam_test_running", 409);
      const items =
        mode === "test"
          ? drawExam(exam, setting, random, module)
          : practiceOrder(exam, setting, questionStats(answersIn(key)), random, module);
      const plan: ExamPlan = {
        mode,
        items,
        sections: sectionsOf(exam, items),
        deadline: mode === "test" ? now() + timeOf(exam, module) * 1000 : null,
        ...(module && { module }),
        ...(mode === "test" && {
          snapshot: items.flatMap((k) => exam.items.find((i) => i.key === k) ?? []),
        }),
      };
      const row = store.replace(
        "exam",
        key,
        { status: "abandoned", reason: "user" },
        { edition, plan },
      );
      return { run: toExamRun(row) as ExamRun, events: [], now: now() };
    },

    /**
     * Answers to the run's questions, stored idempotently (by id) in one transaction; their outcomes
     * computed here. Returned for practice only: a mock exam's are told when it is handed in. A mock
     * exam's answers are taken until its time is up.
     */
    async append(runId: string, input: unknown[], deviceId?: string) {
      const { row, run } = getRun(runId);
      if (row.status !== "active") throw new ServiceError("run_not_active", 409);
      // Its time is up: handed in as it stands, the answers come too late.
      if (run.plan.deadline !== null && now() > run.plan.deadline + GRACE_MS) {
        await handIn(runId, run);
        throw new ServiceError("exam_time_over", 409);
      }
      const exam = await examOf(run.exam);
      // Answers are checked in the language the exam is in (04).
      const lang = examLang(row.edition);
      const asked = new Set<string>(run.plan.items);
      const list = input.map((raw): NewEvent => {
        const parsed = ExamEventInput.safeParse(raw);
        if (!parsed.success) throw new ServiceError("invalid_event");
        const e = parsed.data;
        const question = asked.has(e.itemKey) ? questionOf(exam, run, e.itemKey) : undefined;
        if (!question) throw new ServiceError("no_such_item");
        let outcome: Outcome;
        try {
          outcome = checkQuestion(question, e.payload.answer, lang);
        } catch {
          throw new ServiceError("answer_does_not_fit");
        }
        // Numbered by appendAnswers, after the question's answers the run holds.
        return { ...e, payload: { ...e.payload, outcome } };
      });
      const { outcomes, attempts } = appendAnswers(store, runId, list, { deviceId });
      return { outcomes: run.plan.mode === "practice" ? outcomes : {}, attempts };
    },

    /** Hands the run in (`handIn`), then gives the run with every answer's outcome. */
    async finish(runId: string) {
      const { row, run } = getRun(runId);
      if (row.status === "active") await handIn(runId, run);
      return open(runId);
    },

    /**
     * An open answer rated by its criteria (05): the points of a level of each, by the learner or as the
     * assistant proposed them. Taken while the run is active and after it is handed in — a finished
     * run's result is computed anew. Only an answer given in the run, rated whole.
     */
    async rate(
      runId: string,
      input: {
        id: string;
        itemKey: string;
        ratings: Record<string, number>;
        by: "self" | "assistant";
        model?: string;
      },
      deviceId?: string,
    ) {
      const { row, run, exam, item } = await openAnswer(runId, input.itemKey);
      if (!ratingsFit(item.criteria, input.ratings)) throw new ServiceError("invalid_request");
      store.append(
        runId,
        [
          {
            id: input.id,
            type: "exam_rated",
            itemKey: input.itemKey,
            payload: {
              ratings: input.ratings,
              by: input.by,
              ...(input.model && { model: input.model }),
            },
          },
        ],
        { deviceId, anyStatus: true },
      );
      if (row.status === "finished") store.rescore(runId, resultOf(exam, run));
      return open(runId);
    },
  };
}
export type ExamRuns = ReturnType<typeof createExamRuns>;
