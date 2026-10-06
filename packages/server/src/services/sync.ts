// Syncing an installed course (06, "Jobs"): its provider runs again — fetching only what is missing,
// normalising anew — in the background; the screen polls the job for its log and result. One job per
// course at a time; jobs live in memory (a restart forgets them, the library keeps what was done).
import type { ImportReport } from "@sprachanker/course-kit";

/** Runs a course's provider (the runtime passes it in: providers use Node APIs). */
export type SyncCourse = (
  series: string,
  course: string,
  log: (line: string) => void,
) => Promise<ImportReport>;

export interface SyncJob {
  id: string;
  series: string;
  course: string;
  status: "running" | "done" | "failed";
  startedAt: number;
  finishedAt?: number;
  /** The last lines of the provider's log. */
  log: string[];
  report?: ImportReport;
  error?: string;
}

const LOG_LINES = 200;

export function createSync(deps: {
  run?: SyncCourse;
  now: () => number;
  /** Called when a job ends (done or failed): the course's files may have changed. */
  onEnd?: (series: string, course: string) => void;
}) {
  const jobs = new Map<string, SyncJob>();
  const keyOf = (series: string, course: string) => `${series}/${course}`;

  return {
    available: !!deps.run,

    /** The course's latest job, if any. */
    get: (series: string, course: string) => jobs.get(keyOf(series, course)) ?? null,

    /** Starts syncing the course unless it already runs; returns its job. */
    start(series: string, course: string): SyncJob {
      const key = keyOf(series, course);
      const running = jobs.get(key);
      if (running?.status === "running") return running;
      if (!deps.run) throw new Error("sync_unavailable");
      const job: SyncJob = {
        id: `${key}@${deps.now()}`,
        series,
        course,
        status: "running",
        startedAt: deps.now(),
        log: [],
      };
      jobs.set(key, job);
      const log = (line: string) => {
        job.log.push(line);
        if (job.log.length > LOG_LINES) job.log.splice(0, job.log.length - LOG_LINES);
      };
      deps
        .run(series, course, log)
        .then((report) => {
          job.report = report;
          job.status = "done";
        })
        .catch((error: unknown) => {
          job.error = error instanceof Error ? error.message : String(error);
          job.status = "failed";
        })
        .finally(() => {
          job.finishedAt = deps.now();
          deps.onEnd?.(series, course);
        });
      return job;
    },
  };
}
export type Sync = ReturnType<typeof createSync>;
