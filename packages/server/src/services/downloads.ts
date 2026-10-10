// Downloading courses (06, "Jobs"): a course's provider runs in the background — the first download,
// completing an interrupted or incomplete one, or syncing with the source are the same idempotent
// import. One download at a time, the rest queued; the screens poll for progress. The runtime passes
// the installer (providers use Node APIs); downloads it marked unfinished on disk resume at start.

import type {
  CourseOffer,
  ImportProgress,
  ImportReport,
  ProgressSink,
} from "@sprachanker/course-kit";
import { courseKey, type SeriesKey } from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";

export interface CourseInstaller {
  /** Every course the providers offer, with the series folder it goes to. */
  offers(): OfferedCourse[];
  /** Downloads one course (or what it misses) and normalises it. */
  run(
    series: string,
    course: string,
    hooks: { log: (line: string) => void; progress: ProgressSink },
  ): Promise<ImportReport>;
  /** Downloads that did not end (interrupted, or stopped with an `error`), or ended with `failed`
   *  media files of the course missing. */
  unfinished(): Promise<Array<{ series: string; course: string; failed?: number; error?: string }>>;
  /** The data folder, the bytes each series takes and the bytes still free on its disk. */
  storage(): Promise<{
    dataRoot: string;
    series: Array<{ series: string; bytes: number }>;
    free: number | null;
  }>;
}

interface DownloadProgress {
  phase: ImportProgress["phase"];
  /** Pages read or fetched so far. */
  pages: number;
  /** Media fetched of those missing when the media phase began. */
  media?: { done: number; total: number; bytes: number };
}

export interface DownloadJob {
  id: string;
  series: string;
  course: string;
  status: "queued" | "running" | "done" | "failed";
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  progress?: DownloadProgress;
  /** The last lines of the provider's log. */
  log: string[];
  report?: ImportReport;
  error?: string;
}

const LOG_LINES = 200;
/** Log lines a job carries in the list the screens poll. */
const LISTED_LOG_LINES = 15;
const keyOf = (series: string, course: string): string => courseKey(series as SeriesKey, course);

export function createDownloads(deps: {
  installer?: CourseInstaller;
  now: () => number;
  /** Called when a download ends (done or failed): the course's files may have changed. */
  onEnd?: (series: string, course: string) => void;
}) {
  const jobs = new Map<string, DownloadJob>();
  const queue: DownloadJob[] = [];
  let running = false;

  async function work() {
    if (running || !deps.installer) return;
    running = true;
    for (let job = queue.shift(); job; job = queue.shift()) {
      const current = job;
      current.status = "running";
      current.startedAt = deps.now();
      current.progress = { phase: "pages", pages: 0 };
      const log = (line: string) => {
        current.log.push(line);
        if (current.log.length > LOG_LINES) current.log.splice(0, current.log.length - LOG_LINES);
      };
      const progress = (p: ImportProgress) => {
        const at = current.progress as DownloadProgress;
        at.phase = p.phase;
        if (p.phase === "pages") at.pages = p.done;
        if (p.phase === "media") at.media = { done: p.done, total: p.total, bytes: p.bytes };
      };
      try {
        current.report = await deps.installer.run(current.series, current.course, {
          log,
          progress,
        });
        current.status = "done";
      } catch (error) {
        current.error = error instanceof Error ? error.message : String(error);
        current.status = "failed";
      }
      current.finishedAt = deps.now();
      deps.onEnd?.(current.series, current.course);
    }
    running = false;
  }

  /** Queues a download of the course unless one is queued or running; returns its job. */
  function start(series: string, course: string): DownloadJob {
    if (!deps.installer) throw new ServiceError("downloads_unavailable", 409);
    if (!deps.installer.offers().some((o) => o.series === series && o.course === course))
      throw new ServiceError("not_offered", 404);
    const key = keyOf(series, course);
    const known = jobs.get(key);
    if (known && (known.status === "queued" || known.status === "running")) return known;
    const job: DownloadJob = {
      id: `${key}@${deps.now()}`,
      series,
      course,
      status: "queued",
      queuedAt: deps.now(),
      log: [],
    };
    jobs.set(key, job);
    queue.push(job);
    void work();
    return job;
  }

  return {
    available: !!deps.installer,
    start,

    /** Every job of this server's life, newest first, with the end of its log. */
    list: () =>
      [...jobs.values()]
        .sort((a, b) => b.queuedAt - a.queuedAt)
        .map((job) => ({ ...job, log: job.log.slice(-LISTED_LOG_LINES) })),

    /**
     * Every offered course with its state: `available` (not downloaded), `queued`, `downloading`,
     * `incomplete` (media missing, or a download that did not end), `ready`.
     */
    async catalog(installed: Set<string>): Promise<CatalogEntry[]> {
      const unfinished = new Map(
        ((await deps.installer?.unfinished()) ?? []).map((u) => [keyOf(u.series, u.course), u]),
      );
      return (deps.installer?.offers() ?? []).map((offer) => {
        const key = keyOf(offer.series, offer.course);
        const job = jobs.get(key);
        const left = unfinished.get(key);
        const state: CatalogEntry["state"] =
          job?.status === "queued"
            ? "queued"
            : job?.status === "running"
              ? "downloading"
              : left
                ? "incomplete"
                : installed.has(key)
                  ? "ready"
                  : "available";
        return { ...offer, key, installed: installed.has(key), state, missing: left?.failed };
      });
    },

    /** Queues again the downloads a restart interrupted; those that ended with files missing or
     *  stopped with an error wait for the learner. */
    async resume() {
      for (const u of (await deps.installer?.unfinished()) ?? [])
        if (u.failed === undefined && u.error === undefined)
          try {
            start(u.series, u.course);
          } catch {
            // A course no longer offered: nothing to resume.
          }
    },

    storage: () => deps.installer?.storage() ?? Promise.resolve(null),
  };
}
export type Downloads = ReturnType<typeof createDownloads>;

/** A course as the server offers it: with its series folder, and `experimental` unless its provider
 *  is ready for learning (03). */
type OfferedCourse = CourseOffer & { series: string; experimental?: true };

export interface CatalogEntry extends OfferedCourse {
  key: string;
  /** Its pages are normalised: it can be opened (media may still be coming). */
  installed: boolean;
  state: "available" | "queued" | "downloading" | "incomplete" | "ready";
  /** Media files that failed in the last download. */
  missing?: number;
}
