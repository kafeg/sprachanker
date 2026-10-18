// The course preparation step that hears the source's answers (owner, 2026-10-18: part of how any
// course is installed, made as its AI practice is — course-jobs.ts —, not a hand-run for one course):
// the recordings a course's items are checked by (heard.ts) heard right after the course is
// normalised — its download ended, a bundle of it installed —, and once for every installed course
// with recordings not heard yet (at the server's start, or when its state is first asked for). The same
// for every provider and course: found by the items' data (engine `answerToHear`), never by a
// provider's name. Not in the normaliser: a provider runs no programs and makes the same files of the
// same pages, while what Whisper hears depends on the model (docs/decisions.md). It needs Whisper: with
// no model the course waits, and goes on by itself once one is downloaded. The model: the one the
// engine runs now (a learner's: none swapped in), else the best installed for this machine (a phone's
// small one, its default). A job a course, a lesson a unit, one job at a time on this server; written
// as it goes (heard.ts: every few recordings, in the background — the series' lock never held long);
// stopped on request and kept stopped, across restarts too, until started again; the recordings that
// failed kept on disk with their model (`.heard/<course>.json`), not tried again with it by themselves.
import type { HeardMarker, LessonKey } from "@sprachanker/schema";
import { createCourseJobs, type JobTarget } from "./course-jobs.ts";
import type { Heard, HeardFiles } from "./heard.ts";

type Target = { series: string; course: string };
/** A lesson whose recordings are heard. */
type Unit = { lessonKey: LessonKey };

/** Recordings failing one after another that mean the engine may fail, not they: the job stops with
 *  the engine's error (they are remembered as failed — a few —, tried again by the learner's start). */
const FAILING = 5;
/** A course whose standing shows something left and nothing working on it is looked at again when
 *  its state is asked for, this long after its last look at most (media come in by another way). */
const RELOOK_MS = 30_000;

const keyOf = (t: JobTarget) => `${t.series}/${t.course}`;

export function createHearing(deps: {
  heard: Pick<Heard, "recordings" | "texts" | "onDisk" | "hearPaths" | "finish">;
  files: Pick<HeardFiles, "marker" | "mark">;
  /** The model to hear with now: none while no model (or no engine) is installed. */
  model(): string | undefined;
  /** Whether recognition runs here at all (its engine built, the course files written): without it
   *  a model downloaded changes nothing. */
  engine(): boolean;
  /** The installed courses. */
  courses(): Target[];
  now(): number;
  /** Lets the server answer between courses (a test's is at once). */
  pause?(): Promise<void>;
}) {
  const pause = deps.pause ?? (() => new Promise<void>((r) => setTimeout(r, 0)));
  const jobs = createCourseJobs<Target, Unit>({ now: deps.now, oneAtATime: true });
  /** Courses looked at in this server's life (when); waiting for a model, or for an engine; to look
   *  at again once their job ends (changed while it ran; `true`: the learner's start). */
  const looked = new Map<string, number>();
  const waiting = new Map<string, "model" | "engine">();
  const again = new Map<string, boolean>();
  /** A look going on, by course: asked twice, made once. */
  const looking = new Map<string, Promise<void>>();

  const installed = (t: Target) =>
    deps.courses().some((c) => c.series === t.series && c.course === t.course);
  /** Whether `path` failed before with `model` (none: with any). */
  const failedWith = (marker: HeardMarker, path: string, model: string | undefined) => {
    const f = marker.failed?.[path];
    return !!f && (!model || f.model === model);
  };

  /** A course's recordings: in all, heard, failed with the model of now, not on disk — and by
   *  lesson those left to hear. */
  async function standing(t: Target) {
    const lessons = await deps.heard.recordings(t.series, t.course);
    const have = await deps.heard.texts(t.series, t.course);
    const marker = deps.files.marker(t.series, t.course) ?? {};
    const model = deps.model();
    const counts = { recordings: 0, heard: 0, failed: 0, missing: 0 };
    const left = new Map<LessonKey, string[]>();
    for (const { lessonKey, paths } of lessons)
      for (const path of paths) {
        counts.recordings++;
        if (have[path] !== undefined) counts.heard++;
        else if (!deps.heard.onDisk(t.series, path)) counts.missing++;
        else if (failedWith(marker, path, model)) counts.failed++;
        else {
          const some = left.get(lessonKey);
          if (some) some.push(path);
          else left.set(lessonKey, [path]);
        }
      }
    return { ...counts, left, marker, model };
  }

  /** Starts the course's job over what it has left to hear (`asked`: by the learner — a stop
   *  forgotten, those that failed tried again); without a model it waits. */
  async function lookNow(t: Target, asked: boolean) {
    const k = keyOf(t);
    if (!installed(t)) return forget(t);
    // The learner's start forgets a stop at once, a job still stopping too (looked at again after).
    if (asked) deps.files.mark(t.series, t.course, undefined);
    if (jobs.active(t)) return void again.set(k, asked || (again.get(k) ?? false));
    looked.set(k, deps.now());
    const { left, marker, model } = await standing(t);
    // Removed meanwhile: nothing started for it.
    if (!installed(t)) return forget(t);
    if (marker.stopped || !left.size) return void waiting.delete(k);
    if (!model) return void waiting.set(k, deps.engine() ? "model" : "engine");
    waiting.delete(k);
    let streak: string[] = [];
    const { ended } = jobs.start(
      t,
      [...left.keys()].map((lessonKey) => ({ lessonKey })),
      async ({ lessonKey }, job) => {
        const now = deps.model();
        if (!now) {
          waiting.set(k, deps.engine() ? "model" : "engine");
          return void jobs.stop(t);
        }
        // What a lesson heard meanwhile is left out (hearPaths skips it). Another model taken meanwhile
        // (a learner's) ends the lesson rather than swap the engine back for each recording: the rest
        // is looked at again after the job.
        const failed: NonNullable<HeardMarker["failed"]> = {};
        let swapped = false;
        await deps.heard.hearPaths(t.series, t.course, left.get(lessonKey) ?? [], now, {
          stopped: () => {
            if (deps.model() !== now) swapped = true;
            return job.state !== "running" || streak.length >= FAILING || swapped;
          },
          onFailed: (path) => {
            streak.push(path);
            failed[path] = { model: now, at: deps.now() };
          },
          onDone: (path) => {
            if (streak.at(-1) !== path) streak = [];
          },
        });
        if (swapped && !again.has(k)) again.set(k, false);
        if (streak.length >= FAILING) {
          streak = [];
          jobs.stop(t, "speech_engine_failed");
        }
        if (Object.keys(failed).length && jobs.get(t) === job && installed(t)) {
          // A stop asked meanwhile is on disk: kept.
          const was = deps.files.marker(t.series, t.course) ?? {};
          deps.files.mark(t.series, t.course, { ...was, failed: { ...was.failed, ...failed } });
        }
      },
    );
    void ended.then(async () => {
      await deps.heard
        .finish(t.series, t.course)
        .catch((error: unknown) => console.error(`writing what ${k} heard:`, error));
      const asked = again.get(k);
      if (asked !== undefined) {
        again.delete(k);
        await look(t, asked).catch((error: unknown) =>
          console.error(`looking at what ${k} has to hear:`, error),
        );
      }
    });
  }

  function look(t: Target, asked = false) {
    const k = keyOf(t);
    const going = looking.get(k);
    if (going && !asked) return going;
    const p = (going ?? Promise.resolve())
      .then(() => lookNow(t, asked))
      .finally(() => {
        if (looking.get(k) === p) looking.delete(k);
      });
    looking.set(k, p);
    return p;
  }
  const lookLogged = (t: Target) =>
    look(t).catch((error: unknown) =>
      console.error(`looking at what ${keyOf(t)} has to hear:`, error),
    );

  /** A course removed: its job let go (one running stops after its lesson). */
  function forget(t: Target) {
    const k = keyOf(t);
    jobs.forget(t);
    for (const s of [looked, waiting, again]) s.delete(k);
  }

  return {
    /** A course's recordings of the source's answers as the step stands: how many, heard, failed
     *  (with the model it would hear with now), not on disk; whether it waits for a model or was
     *  stopped; its job. Looked at the first time it is asked for (in the background). */
    async state(series: string, course: string) {
      const t = { series, course };
      const k = keyOf(t);
      const { left, marker, model: _, ...counts } = await standing(t);
      const job = jobs.get(t);
      // The first time; or something left with nothing on it (not stopped, no job but one done).
      const idle = !jobs.active(t) && !waiting.has(k) && !marker.stopped && !job?.error;
      const last = looked.get(k);
      if (
        !looking.has(k) &&
        (last === undefined || (idle && left.size && deps.now() - last >= RELOOK_MS))
      )
        void lookLogged(t);
      return { ...counts, waiting: waiting.get(k) ?? false, stopped: !!marker.stopped, job };
    },

    /** Every course's job. */
    list: () => jobs.list(),

    /** A course installed or changed (its download ended, a bundle installed): what it has to hear,
     *  heard in the background. */
    installed: (series: string, course: string) => void lookLogged({ series, course }),

    /** Every installed course looked at once (the server's start), one after another. */
    async sweep() {
      for (const t of deps.courses()) {
        if (!looked.has(keyOf(t))) await lookLogged(t);
        await pause();
      }
    },

    /** A speech model installed: the courses waiting for one go on. */
    async modelReady() {
      for (const k of [...waiting.keys()]) {
        const [series = "", course = ""] = k.split("/");
        await lookLogged({ series, course });
      }
    },

    /** The learner's start: what the course has left heard — those that failed tried again —, a
     *  stop forgotten. */
    async start(series: string, course: string) {
      await look({ series, course }, true);
      return this.state(series, course);
    },

    /** Stops a course's job after the lesson being heard; kept stopped until started again. */
    stop(series: string, course: string) {
      const t = { series, course };
      jobs.stop(t);
      waiting.delete(keyOf(t));
      deps.files.mark(series, course, { ...deps.files.marker(series, course), stopped: true });
      return this.state(series, course);
    },

    forget: (series: string, course: string) => forget({ series, course }),
  };
}
export type Hearing = ReturnType<typeof createHearing>;
