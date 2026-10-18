// A course's preparation made in one go (owner, 2026-10-18: one machinery for every step that makes
// something into a course after it is installed): a step's job per course (and edition, where the step
// is made per edition) works through its units — a lesson's AI practice step, a lesson's recordings of
// the source's answers heard —, several at a time where the step allows; stopped on request, a unit
// that fails recorded and the job going on. A step whose jobs share one engine runs one job at a time
// on this server (`oneAtATime`: the rest queued). The server's: every profile sees the same jobs. Its
// steps: AI practice (practice: by the profile that started it, its model and voices) and the source's
// answers heard (hearing.ts: Whisper).
import { ServiceError } from "../errors.ts";

/** Which course (and edition) a job prepares. */
export interface JobTarget {
  series: string;
  course: string;
  edition?: string;
}

export type CourseJob<W extends JobTarget, U> = W & {
  /** Units in all, units done (made or failed). */
  total: number;
  done: number;
  /** The units being made now. */
  current: U[];
  failed: Array<U & { error: string }>;
  /** `queued`: behind another job of its step (one at a time). */
  state: "queued" | "running" | "stopping" | "stopped" | "done";
  startedAt: number;
  endedAt: number | null;
  /** Why it was stopped, when not on request (the engine failing). */
  error?: string;
};

/** A unit busy elsewhere (a lesson's own button making the same step) is waited for, this often, this
 *  long. */
const BUSY_WAIT_MS = 3000;
const BUSY_TRIES = 40;

export function createCourseJobs<W extends JobTarget, U>(deps: {
  now: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** One job at a time of this step on this server (it shares an engine), the rest queued. */
  oneAtATime?: boolean;
}) {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  type Job = CourseJob<W, U>;
  const jobs = new Map<string, Job>();
  const waiting: Array<() => void> = [];
  let running = 0;
  const key = (t: JobTarget) => `${t.series}/${t.course}${t.edition ? ` ${t.edition}` : ""}`;
  const active = (job: Job | undefined) =>
    job?.state === "queued" || job?.state === "running" || job?.state === "stopping";

  /** A unit made, one busy elsewhere waited for. */
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

  /** Takes a turn to run (one job at a time: when none runs) — the job running from now. */
  function take(job: Job) {
    if (deps.oneAtATime) running++;
    job.state = "running";
    job.startedAt = deps.now();
  }

  /** Waits for a queued job's turn (false: it was stopped meanwhile, the turn passed on). */
  async function turn(job: Job) {
    await new Promise<void>((r) => waiting.push(r));
    if (job.state !== "queued") {
      waiting.shift()?.();
      return false;
    }
    take(job);
    return true;
  }

  async function run(
    job: Job,
    units: U[],
    make: (u: U, job: Job) => Promise<void>,
    parallel: number,
  ) {
    if (job.state === "queued" && !(await turn(job))) return;
    try {
      let next = 0;
      const worker = async () => {
        for (let unit = units[next++]; unit && job.state === "running"; unit = units[next++]) {
          const u = unit as U;
          job.current.push(u);
          try {
            await attempt(() => make(u, job));
          } catch (error) {
            const message = error instanceof ServiceError ? error.code : (error as Error).message;
            job.failed.push({ ...u, error: message });
          }
          job.current = job.current.filter((c) => c !== u);
          job.done++;
        }
      };
      await Promise.all(Array.from({ length: Math.max(1, parallel) }, worker));
      job.state = job.state === "stopping" ? "stopped" : "done";
      job.endedAt = deps.now();
    } finally {
      if (deps.oneAtATime) {
        running--;
        waiting.shift()?.();
      }
    }
  }

  return {
    /** A course's job of this step, the latest (queued, running or ended), if any. */
    get: (target: JobTarget): Job | null => jobs.get(key(target)) ?? null,

    /** Every job of this step, newest first. */
    list: () => [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt),

    /** Whether a job of the course is queued or running. */
    active: (target: JobTarget) => active(jobs.get(key(target))),

    /** Starts a job over `units`, each made by `make`, `parallel` at a time; refused while one of the
     *  course (and edition) is queued or runs. Its end is `done` (or `stopped`). */
    start(what: W, units: U[], make: (unit: U, job: Job) => Promise<void>, parallel = 1) {
      const k = key(what);
      if (active(jobs.get(k))) throw new ServiceError("practice_busy", 409);
      const job = {
        ...what,
        total: units.length,
        done: 0,
        current: [],
        failed: [],
        state: "queued",
        startedAt: deps.now(),
        endedAt: null,
      } as Job;
      jobs.set(k, job);
      if (!deps.oneAtATime || !running) take(job);
      const ended = run(job, units, make, parallel).catch((error: unknown) => {
        console.error(`preparing ${k}:`, error);
      });
      return { job, ended };
    },

    /** Stops a course's job after the units being made (one queued at once); `error`: why, when
     *  not on request. */
    stop(target: JobTarget, error?: string) {
      const job = jobs.get(key(target));
      if (job?.state === "running") job.state = "stopping";
      else if (job?.state === "queued") {
        job.state = "stopped";
        job.endedAt = deps.now();
      } else return job ?? null;
      if (error) job.error = error;
      return job;
    },

    /** A course's job let go (the course removed): one running stops after its units. */
    forget(target: JobTarget) {
      this.stop(target);
      jobs.delete(key(target));
    },
  };
}
export type CourseJobs<W extends JobTarget, U> = ReturnType<typeof createCourseJobs<W, U>>;
