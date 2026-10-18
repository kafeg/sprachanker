// The source's answers as text (owner, 2026-10-18): the recordings a speaking item's answers are
// checked by (engine `answerToHear`: DW's "Lösungsaudio" of an item with no line to say) heard once
// by Whisper on this machine and written into the course (`heard/<course>.json`), so the engine
// checks an answer said aloud against them, offline, without a model. Server-wide, like the course
// content: a lesson's are heard as the lesson asks for them (the first time a learner who hears
// speech meets it: with that learner's model, the one loaded), in the background, the lesson asking
// again for what is heard by then; a whole course's by `sprachanker heard` (the best model
// installed). A recording another course of the series had heard by the same model is taken from it.
// What is heard is kept in memory until it is written: a write waits for the series' lock (a course
// download of the series holds it) without keeping a request waiting, and one another process holds
// it against is tried again. A recording that fails is not tried again while the server runs. Kept as
// practice is: in the course's bundles, kept when it is removed. Never the reference text given.
import type { LibraryView } from "@sprachanker/course-kit/view";
import { answerToHear, spokenAnswers } from "@sprachanker/engine";
import {
  type CourseHeard,
  type CourseKey,
  courseKey,
  type EditionId,
  HeardRecording,
  type ItemOf,
  type Lang,
  type Lesson,
  type LessonKey,
  lessonOrder,
  parseEditionId,
  parseLessonKey,
  type SeriesKey,
} from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import { createOnce } from "../once.ts";
import type { Content } from "./content.ts";
import { said } from "./silence.ts";
import type { Speech } from "./speech.ts";

/** A course's recordings heard written (runtime adapter: under the series' lock). */
export interface HeardFiles {
  add(
    series: string,
    heard: { course: CourseKey; lang: Lang; recordings: Record<string, HeardRecording> },
  ): Promise<CourseHeard>;
}

/** Recordings heard before what is heard so far is written (a job stopped keeps what it heard). */
const BATCH = 20;
/** How often, and how long apart, a course's last write is tried while another process holds the
 *  series' lock. */
const LAST_WRITE = { tries: 5, ms: 2000 };

/** What a course's hearing found: its items checked by a recording, the recordings, how many were
 *  heard now and taken from another course, failed, and the items whose recording heard is used —
 *  the rest's did not complete their frame (not used, the AI checks them). */
export interface HeardReport {
  course: string;
  model: string;
  items: number;
  recordings: number;
  heard: number;
  reused: number;
  failed: number;
  used: number;
  notUsed: number;
  ms: number;
}

export function createHeard(deps: {
  library: LibraryView;
  content: Content;
  speech: Speech;
  files?: HeardFiles;
  mediaBlob(file: string): Blob;
  now(): number;
  /** Waits (between a course's last writes); a test's is at once. */
  sleep?(ms: number): Promise<void>;
}) {
  const { library, content, speech } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  /** A recording being heard, by series, path and model: asked twice, heard once. */
  const hearing = createOnce<string>();
  /** Recordings heard and not written yet, by series and course. */
  const unwritten = new Map<string, { lang: Lang; recordings: Record<string, HeardRecording> }>();
  /** A course's write going on, by series and course. */
  const writing = new Map<string, Promise<void>>();
  /** Recordings that could not be heard, by series, path and model: a lesson asks for them no more
   *  while the server runs (`sprachanker heard` tries them again). */
  const failed = new Set<string>();
  /** A lesson's hearing going on, by series and lesson. */
  const lessons = new Map<string, Promise<void>>();
  const courseOf = (series: string, course: string) => `${series}|${course}`;

  /** A course's target language: its editions teach one. */
  const langOf = (series: string, course: string): Lang => {
    const edition = library.courses().find((c) => c.series === series && c.course === course)
      ?.editions[0];
    if (!edition) throw new ServiceError("not_installed", 404);
    return parseEditionId(edition as EditionId).target;
  };

  /** The items of a lesson checked by a recording heard, with it. */
  const itemsOf = (lesson: Lesson) =>
    lesson.pages.flatMap(({ exercise }) =>
      exercise.items.flatMap((item, i) => {
        const path = answerToHear(exercise, i);
        return path ? [{ item: item as ItemOf<"speech_selfrate">, path }] : [];
      }),
    );

  /** What a course's recordings say, as written and heard since (by media path). */
  async function texts(series: string, course: string): Promise<Record<string, string>> {
    const kept = await content.heard(series, course);
    const since = unwritten.get(courseOf(series, course))?.recordings ?? {};
    return { ...kept, ...Object.fromEntries(Object.entries(since).map(([p, r]) => [p, r.text])) };
  }

  /** A course's recordings as written, with their model (one not read: none). */
  const written = async (series: string, course: string) =>
    (await library.heard(series, course).catch(() => undefined))?.recordings ?? {};

  /** Writes what a course has heard and not written yet, as one write at a time; what a failed
   *  write held stays for the next. */
  function flush(series: string, course: string): Promise<void> {
    const key = courseOf(series, course);
    const files = deps.files;
    const running = writing.get(key);
    if (running || !files) return running ?? Promise.resolve();
    const job = (async () => {
      for (;;) {
        const pending = unwritten.get(key);
        const recordings = { ...pending?.recordings };
        if (!pending || !Object.keys(recordings).length) return void unwritten.delete(key);
        await files.add(series, {
          course: courseKey(series as SeriesKey, course),
          lang: pending.lang,
          recordings,
        });
        for (const [path, r] of Object.entries(recordings))
          if (pending.recordings[path] === r) delete pending.recordings[path];
      }
    })().finally(() => writing.delete(key));
    writing.set(key, job);
    return job;
  }
  const flushLogged = (series: string, course: string) =>
    flush(series, course).catch((error: unknown) =>
      console.error(`writing the recordings heard of ${series}/${course}:`, error),
    );

  /** What a recording says, as heard with `model`: without the sounds and credits Whisper adds
   *  (silence.ts); undefined when it fails or is longer than a file of them keeps. */
  async function hearOne(series: string, path: string, lang: Lang, model: string) {
    const file = library.mediaFile(series, path);
    if (!file) return undefined;
    const text = await hearing(`${series}|${path}|${model}|${lang}`, async () =>
      said(await speech.transcribe(deps.mediaBlob(file), lang, model), undefined, lang),
    ).catch((error: unknown) => {
      console.error(`hearing ${series}/${path}:`, error);
      return undefined;
    });
    const recording = { text: text ?? "", model, heardAt: deps.now() };
    return text !== undefined && HeardRecording.safeParse(recording).success
      ? recording
      : undefined;
  }

  /**
   * Hears what of `paths` the course has not heard yet (`again`: all of them; `retry`: those that
   * failed before too) with `model`, taking a recording another course of the series heard by the
   * same model from it; kept as each is heard, written every BATCH (`write`).
   */
  async function hear(
    series: string,
    course: string,
    paths: string[],
    model: string,
    options: {
      again?: boolean;
      retry?: boolean;
      write: () => Promise<void>;
      onDone?: (path: string) => void;
    },
  ) {
    if (!deps.files) throw new ServiceError("speech_unavailable", 409);
    const lang = langOf(series, course);
    const have = options.again ? {} : await texts(series, course);
    const tried = (p: string) => !options.retry && failed.has(`${series}|${p}|${model}`);
    const missing = [...new Set(paths)].filter((p) => have[p] === undefined && !tried(p));
    const counts = { heard: 0, reused: 0, failed: 0 };
    if (!missing.length) return counts;
    const others = new Map<string, HeardRecording>();
    if (!options.again)
      for (const c of library.courses())
        if (c.series === series && c.course !== course)
          for (const [path, r] of Object.entries(await written(series, c.course)))
            if (r.model === model) others.set(path, r);
    const key = courseOf(series, course);
    let fresh = 0;
    for (const path of missing) {
      const recording = others.get(path) ?? (await hearOne(series, path, lang, model));
      if (!recording) {
        failed.add(`${series}|${path}|${model}`);
        counts.failed++;
      } else {
        const pending = unwritten.get(key) ?? { lang, recordings: {} };
        pending.recordings[path] = recording;
        unwritten.set(key, pending);
        failed.delete(`${series}|${path}|${model}`);
        if (others.has(path)) counts.reused++;
        else counts.heard++;
        if (++fresh % BATCH === 0) await options.write();
      }
      options.onDone?.(path);
    }
    await options.write();
    return counts;
  }

  /** The best model installed here, if any. */
  const bestModel = () => speech.modelFor(undefined);

  return {
    /**
     * The source's answers a lesson's items are checked by, as heard so far (by media path), and
     * whether more are being heard (`hearing`: asked again, the rest come). Those not heard yet are
     * heard in the background, in the lesson's order, with `model` — the learner's, who hears
     * speech (none: nothing heard). A recording that failed is left out (the AI checks its items).
     */
    async lesson(series: string, lessonKey: LessonKey, model: string | undefined) {
      const lesson = await content.lesson(series, lessonKey);
      const course = parseLessonKey(lessonKey).courseId;
      const paths = [...new Set(itemsOf(lesson).map((i) => i.path))];
      const job = `${series}|${lessonKey}`;
      if (paths.length && model && deps.files) {
        // What another process kept from being written is tried again.
        if (unwritten.has(courseOf(series, course))) void flushLogged(series, course);
        const now = await texts(series, course);
        const left = paths.filter(
          (p) => now[p] === undefined && !failed.has(`${series}|${p}|${model}`),
        );
        if (left.length && !lessons.has(job)) {
          // Written in the background: the series' lock may be held a while.
          const write = async () => void flushLogged(series, course);
          const work = hear(series, course, left, model, { write })
            .then(() => undefined)
            .catch((error: unknown) => console.error(`hearing ${lessonKey}:`, error))
            .finally(() => lessons.delete(job));
          lessons.set(job, work);
        }
      }
      const all = await texts(series, course);
      return {
        heard: Object.fromEntries(
          paths.flatMap((p) => (all[p] !== undefined ? [[p, all[p]]] : [])),
        ) as Record<string, string>,
        hearing: lessons.has(job),
      };
    },

    /** What a course's recordings say, as written and heard since (the server's check of an
     *  answer said aloud). */
    texts,

    /** A whole course's recordings heard with the best model installed (`again`: every one heard
     *  anew; those that failed before tried again); `progress` as each is done. */
    async course(
      series: string,
      course: string,
      options: { again?: boolean; progress?: (done: number, total: number) => void } = {},
    ): Promise<HeardReport> {
      const started = deps.now();
      const model = bestModel();
      if (!model) throw new ServiceError("speech_unavailable", 409);
      const index = await content.courseIndex(series, course);
      const items = [];
      for (const key of lessonOrder(index))
        items.push(...itemsOf(await content.lesson(series, key)));
      const paths = [...new Set(items.map((i) => i.path))];
      let done = 0;
      const counts = await hear(series, course, paths, model, {
        again: options.again,
        retry: true,
        write: () => flushLogged(series, course),
        onDone: () => options.progress?.(++done, paths.length),
      });
      // The last write waits a little for another process holding the series' lock.
      for (let n = 1; ; n++) {
        try {
          await flush(series, course);
          break;
        } catch (error) {
          if (n >= LAST_WRITE.tries) throw error;
          await sleep(LAST_WRITE.ms);
        }
      }
      const lang = langOf(series, course);
      const all = await texts(series, course);
      const used = items.filter(({ item, path }) => spokenAnswers(lang, item, all[path])).length;
      return {
        course: `${series}/${course}`,
        model,
        items: items.length,
        recordings: paths.length,
        ...counts,
        used,
        notUsed: items.length - used,
        ms: deps.now() - started,
      };
    },
  };
}
export type Heard = ReturnType<typeof createHeard>;
