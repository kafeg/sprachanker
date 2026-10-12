// The exams (04, "Exams"; 09, Exams and Notebook): the installed exams with the learner's standing in
// each, an exam's page, the exams' standing and an exam's page in the Notebook — read from its runs
// (exam-runs.ts, whose taking of an exam this service passes on). What reads them hands in the mock
// exams left past their time first (`settleOverdue`).
import {
  examPassed,
  examScore,
  examShare,
  missingSettings,
  openQuestions,
  questionLine,
  questionStats,
  readiness,
} from "@sprachanker/engine";
import {
  type EntryDetail,
  type ExamItemKey,
  type ExamKey,
  type ExamRun,
  examLang,
  type LocaleExam,
  type ModuleStanding,
  type RunSummary,
  STANDING_RUNS,
  seriesOf,
} from "@sprachanker/schema";
import { type Content, courseTitle } from "./content.ts";
import { createExamRuns } from "./exam-runs.ts";
import type { RunStore } from "./run-store.ts";
import type { Settings } from "./settings.ts";

/** A mock exam's share of the most it could score, on the exam's own scale (engine `examShare`):
 *  a module taken alone compared with the whole exam alike. */
const share = (run: ExamRun) => (run.result ? examShare(run.result, "test") : 0);

/** A run as a standing lists it: its points (a mock exam's on the exam's own scale), a mock exam or
 *  practice, the module taken (by its title in `locale`, when given); passed or not for a mock exam
 *  only (practice is judged over the questions answered, which no pass mark is for). */
const summaryOf = (run: ExamRun, locale?: LocaleExam): RunSummary => {
  const { exam: _, plan, result, ...header } = run;
  const passed = plan.mode === "test" ? examPassed(result) : undefined;
  return {
    ...header,
    mode: plan.mode,
    ...(plan.module && { part: locale?.modules?.[plan.module]?.title ?? plan.module }),
    ...(result && examScore(result, plan.mode)),
    ...(passed !== undefined && { passed }),
  };
};

export function createExams(deps: {
  store: RunStore;
  content: Content;
  settings: Settings;
  now: () => number;
}) {
  const { content } = deps;
  const runs = createExamRuns(deps);
  const { setting, answersIn, runsOf, examOf, localeOf, worked, settleOverdue } = runs;

  /** The learner's standing in an exam: each question's stat, how ready, the runs. */
  async function standingIn(key: ExamKey) {
    const exam = await examOf(key);
    const stats = questionStats(answersIn(key));
    const all = runsOf(key, exam);
    const tests = all.filter((r) => r.plan.mode === "test" && r.status === "finished");
    const best = tests.reduce<ExamRun | undefined>(
      (a, r) => (!a || share(r) > share(a) ? r : a),
      undefined,
    );
    return {
      exam,
      stats,
      readiness: readiness(exam, setting, stats),
      needs: missingSettings(exam, setting),
      active: all.find((r) => r.status === "active") ?? null,
      last: tests[0] ?? null,
      best: best ?? null,
      tests: tests.length,
      started: all.length > 0,
    };
  }

  return {
    /** The exams' standing (schema `stats.ts`): each exam with a mock exam handed in — its latest
     *  ones, newest first (practice is its questions' history), open while a run with answers is in
     *  progress — the latest handed in first. */
    async standing(): Promise<ModuleStanding> {
      await settleOverdue();
      const entries = await Promise.all(
        [...(await runs.allRuns())].flatMap(([key, all]) => {
          const tests = all.filter((r) => r.status === "finished" && r.plan.mode === "test");
          const latest = tests[0];
          if (!latest) return [];
          return [
            localeOf(key, latest.edition).then((locale) => ({
              key,
              title: locale?.title ?? null,
              lastAt: latest.finishedAt ?? latest.startedAt,
              open: all.some(worked),
              runCount: tests.length,
              figures: [],
              runs: tests.slice(0, STANDING_RUNS).map((r) => summaryOf(r, locale)),
            })),
          ];
        }),
      );
      return { module: "exam", figures: [], entries: entries.sort((a, b) => b.lastAt - a.lastAt) };
    },

    /** An exam in the Notebook: every mock exam and practice handed in, newest first, and the
     *  questions open to the learner as they stand (known, answered wrongly last time, not seen). */
    async journal(key: ExamKey): Promise<EntryDetail> {
      await settleOverdue();
      // An exam no longer installed still has its runs; its questions are gone with it.
      const exam = await content.exam(seriesOf(key), key).catch(() => undefined);
      const stats = questionStats(answersIn(key));
      const all = runsOf(key, exam);
      const done = all.filter((r) => r.status === "finished");
      const course = (await content.courses()).find((c) => c.exams.includes(key));
      const edition = done[0]?.edition ?? course?.editions[0] ?? null;
      const locale = await localeOf(key, edition);
      /** A question's Teil with its module, named ("Hören · Teil 1"), in an exam of several. */
      const groupOf = (itemKey: string) => {
        const section = exam?.sections.find((s) => s.pool.includes(itemKey as ExamItemKey));
        if (!section || (exam?.sections.length ?? 0) < 2) return undefined;
        const module =
          section.module && (locale?.modules?.[section.module]?.title ?? section.module);
        const teil = locale?.sections[section.key]?.title;
        return [module, teil].filter(Boolean).join(" · ") || undefined;
      };
      const items = (exam ? openQuestions(exam, setting) : []).map((item) => {
        const group = groupOf(item.key);
        return {
          key: item.key,
          state: stats.get(item.key)?.last ?? ("unseen" as const),
          line: questionLine(item),
          ...(group && { group }),
        };
      });
      return {
        entry: {
          key,
          title: locale?.title ?? (course ? courseTitle(course, [edition]) : null),
          lastAt: done[0]?.finishedAt ?? done[0]?.startedAt ?? 0,
          open: all.some(worked),
          runCount: done.length,
          figures: [],
          runs: done.map((r) => summaryOf(r, locale)),
        },
        items,
        lang: examLang(edition),
      };
    },

    /** The installed exams — of exam courses and of courses that have one — with the learner's
     *  standing; titles by edition. */
    async list() {
      await settleOverdue();
      const out = [];
      for (const course of await content.courses())
        for (const key of course.exams) {
          const titles: Record<string, string> = {};
          for (const edition of course.editions) {
            const locale = await content
              .localeExam(course.series, key, edition)
              .catch(() => undefined);
            if (locale) titles[edition] = locale.title;
          }
          const s = await standingIn(key).catch((error: unknown) => {
            console.error(`${key} does not read; left out: ${String(error)}`);
            return undefined;
          });
          if (!s) continue;
          out.push({
            key,
            series: course.series,
            course: course.course,
            kind: course.kind,
            editions: course.editions,
            titles,
            courseTitles: course.titles,
            source: course.source,
            // The questions open to the learner (their federal state's), as the exam's page counts them.
            questions: openQuestions(s.exam, setting).length,
            asked: s.exam.sections.reduce((n, sec) => n + sec.draw, 0),
            timeLimitSec: s.exam.timeLimitSec,
            readiness: s.readiness,
            needs: s.needs,
            active: s.active,
            last: s.last,
            best: s.best,
            tests: s.tests,
            started: s.started,
          });
        }
      return out;
    },

    /** An exam's page: the exam and its texts in an edition, the learner's standing, the stat of
     *  each question answered. */
    async page(key: ExamKey, edition: string) {
      await settleOverdue();
      const s = await standingIn(key);
      const locale = (await content.localeExam(seriesOf(key), key, edition)) ?? null;
      // Where it was read and what was checked (none for an exam imported before they were kept).
      const sources =
        (await content.examSources(seriesOf(key), key).catch((error: unknown) => {
          console.error(`${key}: its sources do not read; left out: ${String(error)}`);
          return undefined;
        })) ?? null;
      return {
        exam: s.exam,
        locale,
        sources,
        readiness: s.readiness,
        needs: s.needs,
        stats: Object.fromEntries(s.stats),
        active: s.active,
        last: s.last,
        best: s.best,
        runs: runsOf(key, s.exam).filter((r) => r.status === "finished"),
      };
    },

    // Taking an exam: exam-runs.ts.
    start: runs.start,
    open: runs.open,
    append: runs.append,
    finish: runs.finish,
    rate: runs.rate,
    openAnswer: runs.openAnswer,
    speakingPart: runs.speakingPart,
  };
}
export type Exams = ReturnType<typeof createExams>;
