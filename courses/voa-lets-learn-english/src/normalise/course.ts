// Normalisation (offline, deterministic): parsed pages + media.json → canonical/ and locale/ files.
// A landing page is a course; the source's lesson groups (Level 1: "Lessons 1 - 10"; Level 2: five lessons
// and their review) are units. An article becomes a lesson: main video, conversation audio and transcript,
// practice videos and the listening quiz as exercises, new words (bold in the transcript) as vocabulary,
// lesson plans and certificates as downloads.
import {
  escapeHtml,
  type KeyMap,
  type LibraryFile,
  libraryFile,
  mediaPath,
  occurrences,
  skippedWords,
  vocabEntries,
} from "@sprachanker/course-kit";
import {
  type CourseIndex,
  courseKey,
  exerciseKey,
  type Lesson,
  type LessonKey,
  type LocaleCourse,
  type LocaleLesson,
  lessonKey,
  type MediaIndex,
  unitKey,
} from "@sprachanker/schema";
import { ATTRIBUTION_HTML, EDITION, SERIES, sourceOf } from "../catalog.ts";
import { normaliseExercise } from "./exercise.ts";
import { type FetchedCourse, planLesson } from "./plan.ts";
import { groupUnits } from "./units.ts";
import { headword } from "./vocab.ts";

export interface CourseResult {
  files: LibraryFile[];
  lessons: number;
  unknown: number;
  /** Source content not imported, for the report. */
  unmapped: string[];
}

/** A course's files; lessons and exercises keep their numbers by source id in `keys`, the series' key
 *  map (02, "Keys"): one the source inserts or a planning rule adds moves no other. */
export function normaliseCourse(
  course: FetchedCourse,
  index: MediaIndex,
  keys: KeyMap,
): CourseResult {
  const media = (url: string | undefined) => mediaPath(index, url);
  const key = courseKey(SERIES, course.def.id);
  const files: LibraryFile[] = [];
  const units: CourseIndex["units"] = [];
  const unitTitles: LocaleCourse["units"] = {};
  const unmappedAll: string[] = [];
  let unknown = 0;
  const groups = groupUnits(course.lessons, course.landing.ranges);
  for (const [u, group] of groups.entries()) {
    const unit = unitKey(key, u + 1);
    unitTitles[unit] = { title: group.title };
    const lessons: LessonKey[] = [];
    for (const [l, lesson] of group.lessons.entries()) {
      const lk = lessonKey(key, u + 1, keys.number(unit, lesson.source.id, l + 1));
      lessons.push(lk);
      const plan = planLesson(lesson);
      const pages: Lesson["pages"] = [];
      const exercises: LocaleLesson["exercises"] = {};
      const exerciseIds = occurrences();
      for (const [i, ex] of plan.exercises.entries()) {
        const id = exerciseIds(ex.kind === "quiz" ? ex.embed.id : ex.sourceId);
        const n = normaliseExercise(
          ex,
          exerciseKey(lk, keys.number(lk, id, i + 1)),
          lesson.raw,
          index,
        );
        pages.push({ exercise: n.exercise });
        exercises[n.exercise.key] = n.locale;
        if (n.unknown) unknown++;
      }
      // en-en: the source gives no definitions on the page (they are in the lesson plan PDF).
      const { vocab, skipped } = vocabEntries(
        lk,
        "en",
        plan.words.map((word) => ({ head: headword(word), target: word })),
      );
      const sd = media(plan.video.sd);
      const hd = media(plan.video.hd);
      const audio = media(plan.audio);
      const unmapped = [
        ...plan.unmapped.map((reason) => ({ path: lesson.raw, reason })),
        ...skippedWords(lesson.raw, skipped),
      ];
      unmappedAll.push(...plan.unmapped.map((r) => `${lk}: ${r}`));
      files.push(
        libraryFile.lesson({
          format: 1,
          key: lk,
          unit,
          media: {
            ...(sd || hd ? { video: { ...(sd ? { sd } : {}), ...(hd ? { hd } : {}) } } : {}),
            ...(audio ? { audio } : {}),
          },
          goals: [],
          pages,
          vocab,
          unmapped,
        }),
      );
      const downloads = plan.downloads.flatMap((d) => {
        const path = media(d.url);
        return path ? [{ title: d.title, path }] : [];
      });
      const summary = lesson.page.summary;
      files.push(
        libraryFile.localeLesson({
          format: 1,
          edition: EDITION,
          lesson: lk,
          sourceId: lesson.source.id,
          title: lesson.page.title || lesson.source.title,
          ...(summary ? { synopsisHtml: `<p>${escapeHtml(summary)}</p>` } : {}),
          exercises,
          vocab: {},
          tabs: {
            grammar: plan.grammar,
            culture: plan.culture,
            ...(plan.script ? { script: plan.script } : {}),
          },
          downloads,
        }),
      );
    }
    units.push({ key: unit, lessons });
  }
  files.push(
    libraryFile.course({
      format: 1,
      key,
      source: sourceOf(course.def),
      units,
      exams: [],
      goals: [],
    }),
  );
  files.push(
    libraryFile.localeCourse({
      format: 1,
      edition: EDITION,
      course: key,
      sourceId: course.sourceId,
      title: course.def.title,
      descriptionHtml: ATTRIBUTION_HTML,
      units: unitTitles,
      goals: {},
    }),
  );
  return {
    files,
    lessons: files.filter((f) => /^canonical\/[^/]+\/lessons\//.test(f.path)).length,
    unknown,
    unmapped: unmappedAll,
  };
}
