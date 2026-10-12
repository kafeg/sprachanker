// Which lessons a run-through goes through, read from the cloned library: `REAL`
// names them by key prefix (comma-separated: a series, a course, a lesson), else the first course of
// every series; `REAL_PER_COURSE` is how many lessons of each course, spread over it (1 by default: the
// first; "all" for every one).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Exam, Lesson, LocaleLesson } from "@sprachanker/schema";
import { LIBRARY } from "./data.ts";

export interface Scenario {
  series: string;
  course: string;
  /** The lesson's name in its course ("00-01") and its key. */
  lesson: string;
  key: string;
  edition: string;
}

const dirs = (path: string) =>
  existsSync(path)
    ? readdirSync(path, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
    : [];

/** The edition a course is installed in (its first: the locale folder that holds it). */
const editionOf = (series: string, course: string) =>
  dirs(join(LIBRARY, series, "locale")).find((e) =>
    existsSync(join(LIBRARY, series, "locale", e, course)),
  );

/** `n` of `list` spread evenly from its first (all when `n` is not less than its length). */
const spread = <T>(list: T[], n: number) =>
  n >= list.length
    ? list
    : Array.from(
        { length: n },
        (_, i) => list[Math.round((i * (list.length - 1)) / Math.max(1, n - 1))] as T,
      );

export function scenarios(): Scenario[] {
  const prefixes = (process.env.REAL ?? "").split(",").filter(Boolean);
  const per =
    process.env.REAL_PER_COURSE === "all" ? Infinity : Number(process.env.REAL_PER_COURSE ?? 1);
  const out: Scenario[] = [];
  for (const series of dirs(LIBRARY)) {
    const courses = dirs(join(LIBRARY, series, "canonical"));
    // Without a selection, the first course of each series.
    const chosen = prefixes.length
      ? courses.filter((c) =>
          prefixes.some((p) => `${series}/${c}`.startsWith(p) || p.startsWith(`${series}/${c}/`)),
        )
      : courses.slice(0, 1);
    for (const course of chosen) {
      const edition = editionOf(series, course);
      const lessons = join(LIBRARY, series, "canonical", course, "lessons");
      // An exam's course has none (examScenarios).
      if (!edition || !existsSync(lessons)) continue;
      const all = readdirSync(lessons)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.slice(0, -5))
        .sort();
      // Lessons named by key: just those; else the course's from the first.
      const named = all.filter((l) => prefixes.includes(`${series}/${course}/${l}`));
      for (const lesson of named.length ? named : spread(all, per))
        out.push({ series, course, lesson, key: `${series}/${course}/${lesson}`, edition });
    }
  }
  return out;
}

/** The lesson's canonical file and its texts in the edition. */
export function lessonFiles(s: Scenario): { lesson: Lesson; locale: LocaleLesson } {
  const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
  return {
    lesson: read(join(LIBRARY, s.series, "canonical", s.course, "lessons", `${s.lesson}.json`)),
    locale: read(
      join(LIBRARY, s.series, "locale", s.edition, s.course, "lessons", `${s.lesson}.json`),
    ),
  };
}

/** An installed exam to take: its course, its slug ("test") and its key, its edition. */
export interface ExamScenario {
  series: string;
  course: string;
  exam: string;
  key: string;
  edition: string;
}

/** The installed exams, narrowed by `REAL` as lessons are (a series, a course or the exam's key). */
export function examScenarios(): ExamScenario[] {
  const prefixes = (process.env.REAL ?? "").split(",").filter(Boolean);
  const out: ExamScenario[] = [];
  for (const series of dirs(LIBRARY))
    for (const course of dirs(join(LIBRARY, series, "canonical"))) {
      const folder = join(LIBRARY, series, "canonical", course, "exams");
      const edition = editionOf(series, course);
      if (!existsSync(folder) || !edition) continue;
      for (const file of readdirSync(folder)
        .filter((f) => f.endsWith(".json"))
        .sort()) {
        const exam = file.slice(0, -5);
        const key = `${series}/${course}/exam-${exam}`;
        if (prefixes.length && !prefixes.some((p) => key.startsWith(p))) continue;
        out.push({ series, course, exam, key, edition });
      }
    }
  return out;
}

/** The exam's canonical file. */
export const examFile = (s: ExamScenario): Exam =>
  JSON.parse(
    readFileSync(join(LIBRARY, s.series, "canonical", s.course, "exams", `${s.exam}.json`), "utf8"),
  );
