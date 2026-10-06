// Verifying the library (02, 03): every installed course is read the way the app reads it — through the
// schemas — and checked beyond them: keys that refer to each other, answers that refer to existing
// options and gaps, fingerprints, locale texts per edition, and media files on disk. One report per
// course; `problems` must be empty, `notes` are worth a look (e.g. exercises without locale texts).
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  correctOptions,
  type Exercise,
  type Lesson,
  type LessonKey,
  type LocaleLesson,
} from "@sprachanker/schema";
import { fingerprint } from "./fingerprint.ts";
import type { CourseReport, LibraryView } from "./library-view.ts";

export type { CourseReport } from "./library-view.ts";

/** Every `media/…` path inside a value (lesson, exercise, locale file). */
function mediaPaths(value: unknown, out: Set<string>) {
  if (typeof value === "string") {
    for (const m of value.matchAll(/media\/[^\s"'<>)]+/g)) out.add(m[0]);
  } else if (Array.isArray(value)) for (const v of value) mediaPaths(v, out);
  else if (value && typeof value === "object")
    for (const v of Object.values(value)) mediaPaths(v, out);
}

/** Answers and gaps that point to options, parts or gaps the item does not have. */
function answerProblems(exercise: Exercise): string[] {
  const out: string[] = [];
  exercise.items.forEach((item, i) => {
    const at = `${exercise.key}#${i + 1}`;
    const missing = (ids: string[], known: Array<{ id: string }>, what: string) => {
      const have = new Set(known.map((o) => o.id));
      for (const id of ids)
        if (!have.has(id)) out.push(`${at}: answer names ${what} "${id}" it does not have`);
    };
    switch (exercise.type) {
      case "single_choice":
      case "multi_choice": {
        const it = item as Extract<Exercise, { type: "single_choice" }>["items"][number];
        missing(it.answer.optionIds, it.options, "option");
        break;
      }
      case "match": {
        const it = item as Extract<Exercise, { type: "match" }>["items"][number];
        missing(
          it.answer.pairs.map((p) => p[0]),
          it.left,
          "left entry",
        );
        missing(
          it.answer.pairs.map((p) => p[1]),
          it.right,
          "right entry",
        );
        break;
      }
      case "order": {
        const it = item as Extract<Exercise, { type: "order" }>["items"][number];
        missing(it.answer.sequence, it.parts, "part");
        if (it.answer.sequence.length !== it.parts.length)
          out.push(
            `${at}: the order uses ${it.answer.sequence.length} of ${it.parts.length} parts`,
          );
        break;
      }
      case "gap_text":
      case "gap_choice": {
        const it = item as Extract<Exercise, { type: "gap_text" }>["items"][number];
        const gaps = it.segments.flatMap((s) => (typeof s === "string" ? [] : [s.gap]));
        const answered = Object.keys(it.answer);
        if (!gaps.length) out.push(`${at}: no gaps in the text`);
        for (const g of gaps) if (!answered.includes(g)) out.push(`${at}: gap ${g} has no answer`);
        for (const g of answered)
          if (!gaps.includes(g)) out.push(`${at}: answer for missing gap ${g}`);
        if (exercise.type === "gap_choice") {
          const gc = item as Extract<Exercise, { type: "gap_choice" }>["items"][number];
          for (const [g, want] of Object.entries(gc.answer))
            missing(correctOptions(want), gc.gaps[g]?.options ?? [], `option for ${g}`);
        }
        break;
      }
    }
  });
  return out;
}

/** Locale texts of one edition that do not match the canonical lesson. */
function localeProblems(lesson: Lesson, locale: LocaleLesson, edition: string) {
  const problems: string[] = [];
  const notes: string[] = [];
  if (locale.lesson !== lesson.key)
    problems.push(`${edition} ${lesson.key}: locale is for ${locale.lesson}`);
  const exercises = new Map(lesson.pages.map((p) => [p.exercise.key as string, p.exercise]));
  for (const [key, ex] of Object.entries(locale.exercises)) {
    const canonical = exercises.get(key);
    if (!canonical) {
      problems.push(`${edition} ${key}: locale texts for an exercise the lesson does not have`);
      continue;
    }
    for (const ref of Object.keys(ex.items)) {
      const n = Number(ref.slice(1));
      if (!(n >= 1 && n <= canonical.items.length))
        problems.push(`${edition} ${key}: locale item ${ref} of ${canonical.items.length}`);
    }
  }
  const untitled = lesson.pages.filter((p) => !locale.exercises[p.exercise.key]).length;
  if (untitled) notes.push(`${edition} ${lesson.key}: ${untitled} exercises without locale texts`);
  const vocab = new Set(lesson.vocab.map((v) => v.key as string));
  for (const key of Object.keys(locale.vocab))
    if (!vocab.has(key))
      problems.push(`${edition} ${key}: translation of a word the lesson does not have`);
  const untranslated = lesson.vocab.filter((v) => !locale.vocab[v.key]).length;
  if (untranslated)
    notes.push(`${edition} ${lesson.key}: ${untranslated} words without translation`);
  return { problems, notes };
}

export async function verifyLibrary(library: LibraryView): Promise<CourseReport[]> {
  const reports: CourseReport[] = [];
  for (const { series, course, editions } of library.courses())
    reports.push(await verifyCourse(library, series, course, editions));
  return reports;
}

/** Checks one installed course (see the file comment). */
export async function verifyCourse(
  library: LibraryView,
  series: string,
  course: string,
  editions: string[],
): Promise<CourseReport> {
  const report: CourseReport = {
    series,
    course,
    editions,
    units: 0,
    lessons: 0,
    exercises: {},
    items: 0,
    vocab: 0,
    media: { referenced: 0, missing: 0, byKind: {}, bytes: 0 },
    problems: [],
    notes: [],
  };
  const guard = async <T>(what: string, read: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await read();
    } catch (error) {
      report.problems.push(`${what}: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  };
  const index = await guard("course.json", () => library.courseIndex(series, course));
  if (!index) return report;
  if (!editions.length) report.problems.push("no edition (locale course.json) installed");
  const media = new Set<string>();
  const listed = new Set<string>();
  report.units = index.units.length;
  for (const unit of index.units) {
    for (const key of unit.lessons) {
      if (listed.has(key)) report.problems.push(`${key}: listed twice in course.json`);
      listed.add(key);
      const lesson = await guard(key, () => library.lesson(series, key as LessonKey));
      if (!lesson) continue;
      report.lessons++;
      if (lesson.key !== key) report.problems.push(`${key}: the file holds ${lesson.key}`);
      if (lesson.unit !== unit.key)
        report.problems.push(`${key}: unit ${lesson.unit}, listed in ${unit.key}`);
      report.vocab += lesson.vocab.length;
      mediaPaths(lesson, media);
      for (const { exercise } of lesson.pages) {
        report.exercises[exercise.type] = (report.exercises[exercise.type] ?? 0) + 1;
        report.items += exercise.items.length;
        if (exercise.fingerprint !== fingerprint(exercise))
          report.problems.push(`${exercise.key}: fingerprint does not match its content`);
        report.problems.push(...answerProblems(exercise));
      }
      for (const edition of editions) {
        const locale = await guard(`${edition} ${key}`, () =>
          library.localeLesson(series, key as LessonKey, edition),
        );
        if (!locale) {
          report.problems.push(`${edition} ${key}: no locale file`);
          continue;
        }
        mediaPaths(locale, media);
        const found = localeProblems(lesson, locale, edition);
        report.problems.push(...found.problems);
        report.notes.push(...found.notes);
      }
    }
  }
  for (const edition of editions) {
    const locale = await guard(`${edition} course.json`, () =>
      library.localeCourse(series, course, edition),
    );
    for (const unit of index.units)
      if (locale && !locale.units[unit.key])
        report.notes.push(`${edition} ${unit.key}: no unit title`);
  }
  // Lesson files the course does not list are never shown.
  const dir = join(library.root, series, "canonical", course, "lessons");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const key = `${series}/${course}/${file.slice(0, -5)}`;
    if (!listed.has(key)) report.problems.push(`${key}: lesson file not listed in course.json`);
  }
  if (report.exercises.unknown)
    report.notes.push(`${report.exercises.unknown} exercises of an unknown structure (not shown)`);
  report.media.referenced = media.size;
  for (const path of media) {
    const kind = path.split("/")[1] ?? "other";
    report.media.byKind[kind] ??= { present: 0, missing: 0 };
    const counts = report.media.byKind[kind];
    const file = library.mediaFile(series, path);
    if (file) {
      counts.present++;
      report.media.bytes += statSync(file).size;
    } else {
      counts.missing++;
      report.media.missing++;
      if (report.media.missing <= 20) report.problems.push(`missing media: ${path}`);
    }
  }
  return report;
}
