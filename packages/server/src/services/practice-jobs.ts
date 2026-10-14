// A course's practice made in one go (owner, 2026-10-14: a button on the course's page and the
// command line): a job per course and edition — its lessons in course order, each step asked made
// `count` times (1–3) into the course's practice by the profile that started it (its model, its
// voices), one after another —; one job of a course's edition at a time, stopped on request, a unit
// that fails recorded and the job going on. The server's: every profile sees it.
import type { LessonKey } from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import type { PracticeStepName } from "./practice.ts";

/** One lesson's step to make. */
export interface PracticeUnit {
  lessonKey: LessonKey;
  step: PracticeStepName;
}

export interface PracticeJob {
  series: string;
  course: string;
  edition: string;
  steps: PracticeStepName[];
  count: number;
  /** Units in all, units done (made or failed). */
  total: number;
  done: number;
  /** The unit being made now. */
  current: PracticeUnit | null;
  failed: Array<PracticeUnit & { error: string }>;
  state: "running" | "stopping" | "stopped" | "done";
  startedAt: number;
  endedAt: number | null;
}

/** A lesson's step being made by its own button meanwhile is waited for, this often, this long. */
const BUSY_WAIT_MS = 3000;
const BUSY_TRIES = 40;

export function createPracticeJobs(deps: {
  now: () => number;
  sleep?: (ms: number) => Promise<void>;
}) {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const jobs = new Map<string, PracticeJob>();
  const key = (series: string, course: string, edition: string) => `${series}/${course} ${edition}`;

  /** A unit made, a lesson's own button making the same step waited for. */
  async function attempt(make: () => Promise<void>) {
    for (let tries = 1; ; tries++) {
      try {
        return await make();
      } catch (error) {
        const busy = error instanceof ServiceError && error.code.endsWith("_busy");
        if (!busy || tries >= BUSY_TRIES) throw error;
        await sleep(BUSY_WAIT_MS);
      }
    }
  }

  async function run(
    job: PracticeJob,
    units: PracticeUnit[],
    make: (u: PracticeUnit) => Promise<void>,
  ) {
    for (const unit of units) {
      if (job.state === "stopping") break;
      job.current = unit;
      try {
        await attempt(() => make(unit));
      } catch (error) {
        const message = error instanceof ServiceError ? error.code : (error as Error).message;
        job.failed.push({ ...unit, error: message });
      }
      job.done++;
    }
    job.current = null;
    job.state = job.state === "stopping" ? "stopped" : "done";
    job.endedAt = deps.now();
  }

  return {
    /** A course's edition's job, the latest (running or ended), if any. */
    get: (series: string, course: string, edition: string): PracticeJob | null =>
      jobs.get(key(series, course, edition)) ?? null,

    /** Starts a job over `units`, each made by `make`; refused while one of the course's edition
     *  runs. Its end is `done` (or `stopped`). */
    start(
      what: Pick<PracticeJob, "series" | "course" | "edition" | "steps" | "count">,
      units: PracticeUnit[],
      make: (unit: PracticeUnit) => Promise<void>,
    ) {
      const k = key(what.series, what.course, what.edition);
      const running = jobs.get(k);
      if (running && (running.state === "running" || running.state === "stopping"))
        throw new ServiceError("practice_busy", 409);
      const job: PracticeJob = {
        ...what,
        total: units.length,
        done: 0,
        current: null,
        failed: [],
        state: "running",
        startedAt: deps.now(),
        endedAt: null,
      };
      jobs.set(k, job);
      const ended = run(job, units, make).catch((error: unknown) => {
        console.error(`practice of ${k}:`, error);
      });
      return { job, ended };
    },

    /** Stops a course's edition's job after the unit being made. */
    stop(series: string, course: string, edition: string) {
      const job = jobs.get(key(series, course, edition));
      if (job?.state === "running") job.state = "stopping";
      return job ?? null;
    },
  };
}
export type PracticeJobs = ReturnType<typeof createPracticeJobs>;
