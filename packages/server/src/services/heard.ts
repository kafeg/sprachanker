// The source's answers as text (owner, 2026-10-18): the recordings a speaking item's answers are
// checked by (engine `answerToHear`: DW's "Lösungsaudio" of an item with no line to say) heard once
// by Whisper on this machine and written into the course (`heard/<course>.json`), so the engine
// checks an answer said aloud against them, offline, without a model. Server-wide, like the course
// content: a lesson's are heard as the lesson asks for them (the first time a learner who hears
// speech meets it), a whole course's by `sprachanker heard`; a recording another course of the series
// had heard by the same model is taken from it. Kept as practice is: in the course's bundles, kept
// when it is removed. Made with the best model installed here, never the reference text given to it.
import type { LibraryView } from "@sprachanker/course-kit/view";
import { answerToHear, spokenAnswers } from "@sprachanker/engine";
import {
  type CourseHeard,
  type CourseKey,
  courseKey,
  type EditionId,
  type HeardRecording,
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
import type { Speech } from "./speech.ts";

/** A course's recordings heard written (runtime adapter: under the series' lock). */
export interface HeardFiles {
  add(
    series: string,
    heard: { course: CourseKey; lang: Lang; recordings: Record<string, HeardRecording> },
  ): Promise<CourseHeard>;
}

/** Recordings written together while a course is heard (a job stopped keeps what it heard). */
const BATCH = 20;

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
}) {
  const { library, content, speech } = deps;
  /** A recording being heard, by series, path and model: asked twice, heard once. */
  const hearing = createOnce<string>();

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

  /**
   * Hears what of `paths` the course has not heard yet (`again`: all of them) with `model`, taking a
   * recording another course of the series heard by the same model from it; written in batches.
   */
  async function hear(
    series: string,
    course: string,
    paths: string[],
    model: string,
    again = false,
    onDone?: (path: string) => void,
  ) {
    const files = deps.files;
    if (!files) throw new ServiceError("speech_unavailable", 409);
    const lang = langOf(series, course);
    const have = again ? {} : ((await library.heard(series, course))?.recordings ?? {});
    const missing = [...new Set(paths)].filter((p) => !have[p]);
    const counts = { heard: 0, reused: 0, failed: 0 };
    if (!missing.length) return counts;
    const others = new Map<string, HeardRecording>();
    if (!again)
      for (const c of library.courses())
        if (c.series === series && c.course !== course)
          for (const [path, r] of Object.entries(
            (await library.heard(series, c.course))?.recordings ?? {},
          ))
            if (r.model === model) others.set(path, r);
    let batch: Record<string, HeardRecording> = {};
    const write = async () => {
      if (!Object.keys(batch).length) return;
      const recordings = batch;
      batch = {};
      await files.add(series, { course: courseKey(series as SeriesKey, course), lang, recordings });
    };
    for (const path of missing) {
      const reused = others.get(path);
      if (reused) {
        batch[path] = reused;
        counts.reused++;
      } else {
        const file = library.mediaFile(series, path);
        const text = file
          ? await hearing(`${series}|${path}|${model}|${lang}`, async () => {
              const heard = await speech.transcribe(deps.mediaBlob(file), lang, model);
              return heard.text;
            }).catch((error: unknown) => {
              console.error(`hearing ${series}/${path}:`, error);
              return undefined;
            })
          : undefined;
        if (text === undefined) {
          counts.failed++;
          onDone?.(path);
          continue;
        }
        batch[path] = { text, model, heardAt: deps.now() };
        counts.heard++;
      }
      onDone?.(path);
      if (Object.keys(batch).length >= BATCH) await write();
    }
    await write();
    return counts;
  }

  /** The best model installed here, if any. */
  const bestModel = () => speech.modelFor(undefined);

  return {
    /**
     * The source's answers a lesson's items are checked by, as heard (by media path): those not
     * heard yet heard first when `hears` — the learner hears speech, so their answers will be heard
     * too — and a model is installed. A hearing that fails leaves them out (asked again next time).
     */
    async lesson(series: string, lessonKey: LessonKey, hears: boolean) {
      const lesson = await content.lesson(series, lessonKey);
      const course = parseLessonKey(lessonKey).courseId;
      const paths = [...new Set(itemsOf(lesson).map((i) => i.path))];
      const model = hears ? bestModel() : undefined;
      if (paths.length && model) {
        const stored = await content.heard(series, course);
        if (paths.some((p) => stored[p] === undefined))
          await hear(series, course, paths, model).catch((error: unknown) =>
            console.error(`hearing ${lessonKey}:`, error),
          );
      }
      const texts = await content.heard(series, course);
      return Object.fromEntries(
        paths.flatMap((p) => (texts[p] !== undefined ? [[p, texts[p]]] : [])),
      );
    },

    /** A whole course's recordings heard (`again`: every one heard anew); `progress` as each is
     *  done. */
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
      const counts = await hear(series, course, paths, model, options.again, () =>
        options.progress?.(++done, paths.length),
      );
      const lang = langOf(series, course);
      const texts = await content.heard(series, course);
      const used = items.filter(({ item, path }) => spokenAnswers(lang, item, texts[path])).length;
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
