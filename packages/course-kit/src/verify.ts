// Verifying the library (02, 03): every installed course is read the way the app reads it — through the
// schemas — and checked beyond them: keys that refer to each other, answers that refer to existing
// options and gaps, fingerprints, locale texts per edition, and media files on disk. One report per
// course; `problems` must be empty, `notes` are worth a look (e.g. exercises without locale texts).
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  correctOptions,
  type Exam,
  type ExamKey,
  type ExamSources,
  type Exercise,
  type Lesson,
  type LessonKey,
  type LocaleExam,
  type LocaleLesson,
} from "@sprachanker/schema";
import { hashFile } from "./files.ts";
import { fingerprint } from "./fingerprint.ts";
import type { CourseProblem, CourseReport, LibraryView } from "./library-view.ts";

export type { CourseReport } from "./library-view.ts";

const problem = (kind: CourseProblem["kind"], at: string, text: string): CourseProblem => ({
  kind,
  at,
  text: `${at}: ${text}`,
});
/** Data that do not agree. */
const inconsistent = (at: string, text: string) => problem("inconsistent", at, text);

/** Every `media/…` path inside a value (lesson, exercise, locale file). */
function mediaPaths(value: unknown, out: Set<string>) {
  if (typeof value === "string") {
    // A library path (a value, or src="…" in HTML), not "multimedia/…" in a text.
    for (const m of value.matchAll(/(?<![\w/.-])media\/[^\s"'<>)]+/g)) out.add(m[0]);
  } else if (Array.isArray(value)) for (const v of value) mediaPaths(v, out);
  else if (value && typeof value === "object")
    for (const v of Object.values(value)) mediaPaths(v, out);
}

/** Answers and gaps that point to options, parts or gaps the item does not have; `at` names an item
 *  (an exercise's by its position, an exam's question by its key). */
function answerProblems(
  exercise: Exercise,
  atOf = (i: number) => `${exercise.key}#${i + 1}`,
): CourseProblem[] {
  const out: CourseProblem[] = [];
  exercise.items.forEach((item, i) => {
    const at = atOf(i);
    const missing = (ids: string[], known: Array<{ id: string }>, what: string) => {
      const have = new Set(known.map((o) => o.id));
      for (const id of ids)
        if (!have.has(id))
          out.push(inconsistent(at, `answer names ${what} "${id}" it does not have`));
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
            inconsistent(
              at,
              `the order uses ${it.answer.sequence.length} of ${it.parts.length} parts`,
            ),
          );
        break;
      }
      case "gap_text":
      case "gap_choice": {
        const it = item as Extract<Exercise, { type: "gap_text" }>["items"][number];
        const gaps = it.segments.flatMap((s) => (typeof s === "string" ? [] : [s.gap]));
        const answered = Object.keys(it.answer);
        if (!gaps.length) out.push(inconsistent(at, "no gaps in the text"));
        for (const g of gaps)
          if (!answered.includes(g)) out.push(inconsistent(at, `gap ${g} has no answer`));
        for (const g of answered)
          if (!gaps.includes(g)) out.push(inconsistent(at, `answer for missing gap ${g}`));
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
  const problems: CourseProblem[] = [];
  const notes: string[] = [];
  if (locale.lesson !== lesson.key)
    problems.push(inconsistent(`${edition} ${lesson.key}`, `locale is for ${locale.lesson}`));
  const exercises = new Map(lesson.pages.map((p) => [p.exercise.key as string, p.exercise]));
  for (const [key, ex] of Object.entries(locale.exercises)) {
    const canonical = exercises.get(key);
    if (!canonical) {
      problems.push(
        inconsistent(`${edition} ${key}`, "locale texts for an exercise the lesson does not have"),
      );
      continue;
    }
    for (const ref of Object.keys(ex.items)) {
      const n = Number(ref.slice(1));
      if (!(n >= 1 && n <= canonical.items.length))
        problems.push(
          inconsistent(`${edition} ${key}`, `locale item ${ref} of ${canonical.items.length}`),
        );
    }
  }
  const untitled = lesson.pages.filter((p) => !locale.exercises[p.exercise.key]).length;
  if (untitled) notes.push(`${edition} ${lesson.key}: ${untitled} exercises without locale texts`);
  const vocab = new Set(lesson.vocab.map((v) => v.key as string));
  for (const key of Object.keys(locale.vocab))
    if (!vocab.has(key))
      problems.push(
        inconsistent(`${edition} ${key}`, "translation of a word the lesson does not have"),
      );
  const untranslated = lesson.vocab.filter((v) => !locale.vocab[v.key]).length;
  if (untranslated)
    notes.push(`${edition} ${lesson.key}: ${untranslated} words without translation`);
  return { problems, notes };
}

/** An exam that does not hold together: questions of another exam or twice, answers to options a
 *  question lacks, pools naming questions not there or drawing more than they hold (for each value of
 *  a filtered section's tag), pass marks above the questions asked. */
function examProblems(exam: Exam, key: string): CourseProblem[] {
  const out: CourseProblem[] = [];
  if (exam.key !== key) out.push(inconsistent(key, `the file holds ${exam.key}`));
  const items = new Map(exam.items.map((i) => [i.key as string, i]));
  if (items.size !== exam.items.length) out.push(inconsistent(key, "a question listed twice"));
  for (const item of exam.items) {
    if (!item.key.startsWith(`${exam.key}/q-`))
      out.push(inconsistent(item.key, `not a question of ${exam.key}`));
    // Each question checked as an item of its kind is, named by its key.
    const asExercise = { key: exam.key, type: item.type, items: [item] };
    out.push(...answerProblems(asExercise as unknown as Exercise, () => item.key));
    // An open answer's criteria: each once, its levels best first; its points their best together.
    if (item.criteria) {
      const ids = item.criteria.map((c) => c.id);
      if (new Set(ids).size !== ids.length)
        out.push(inconsistent(item.key, "a criterion listed twice"));
      for (const c of item.criteria)
        if (c.levels.some((l, i) => i > 0 && l >= (c.levels[i - 1] as number)))
          out.push(inconsistent(item.key, `criterion ${c.id}: levels not from best to worst`));
      const most = item.criteria.reduce((n, c) => n + Math.max(...c.levels), 0);
      if (item.points !== undefined && item.points !== most)
        out.push(inconsistent(item.key, `${item.points} points, its criteria give ${most}`));
    }
  }
  const modules = new Map((exam.modules ?? []).map((m) => [m.id, m]));
  if (modules.size !== (exam.modules ?? []).length)
    out.push(inconsistent(key, "a module listed twice"));
  if (exam.modules) {
    const together = exam.modules.reduce((n, m) => n + m.timeLimitSec, 0);
    if (together !== exam.timeLimitSec)
      out.push(inconsistent(key, `time ${exam.timeLimitSec} s, its modules' ${together} s`));
  }
  const worth = (k: string) => items.get(k)?.points ?? 1;
  /** The most points each module (or the one test) can give: its sections' best draws. */
  const best = new Map<string, number>();
  const pooled = new Set<string>();
  for (const section of exam.sections) {
    if (exam.modules && !section.module) out.push(inconsistent(section.key, "in no module"));
    if (section.module && !modules.has(section.module))
      out.push(inconsistent(section.key, `module ${section.module} is not the exam's`));
    const pool = section.pool.flatMap((k) => {
      pooled.add(k);
      const item = items.get(k);
      if (!item) out.push(inconsistent(section.key, `pool names ${k}, not a question of the exam`));
      return item ? [item] : [];
    });
    const groups = section.filter
      ? Map.groupBy(pool, (i) => i.tags[section.filter?.tag ?? ""] ?? null)
      : new Map([[null, pool]]);
    for (const [value, group] of groups)
      if (group.length < section.draw)
        out.push(
          inconsistent(
            section.key,
            `draws ${section.draw} of ${group.length} questions${value === null ? "" : ` (${value})`}`,
          ),
        );
    const top = pool
      .map((i) => worth(i.key))
      .sort((a, b) => b - a)
      .slice(0, section.draw)
      .reduce((n, p) => n + p, 0);
    best.set(section.module ?? "", (best.get(section.module ?? "") ?? 0) + top);
  }
  for (const section of exam.sections)
    for (const example of section.examples ?? [])
      if (!items.has(example) || pooled.has(example))
        out.push(inconsistent(section.key, `example ${example} is no question of its own`));
  for (const t of exam.thresholds) {
    for (const m of t.modules ?? [])
      if (!modules.has(m)) out.push(inconsistent(key, `pass mark ${t.id} names module ${m}`));
    const over = exam.modules ? (t.modules ?? [...modules.keys()]) : [""];
    const most = over.reduce((n, m) => n + (modules.get(m)?.scaleTo ?? best.get(m) ?? 0), 0);
    if (t.minPoints > most)
      out.push(inconsistent(key, `pass mark ${t.id} is ${t.minPoints} of ${most} points`));
  }
  return out;
}

/**
 * An exam's sources that do not hold (03): a question without its place in a document, a place in a
 * document not listed, a kept copy missing or changed since it was read (its sha256), a check that did
 * not pass for every question.
 */
async function sourcesProblems(
  library: LibraryView,
  series: string,
  exam: Exam,
  sources: ExamSources,
): Promise<CourseProblem[]> {
  const out: CourseProblem[] = [];
  const at = `${exam.key} sources`;
  if (sources.exam !== exam.key) out.push(inconsistent(at, `the file is for ${sources.exam}`));
  const documents = new Set(sources.documents.map((d) => d.id));
  for (const item of exam.items) {
    const found = sources.items[item.key];
    if (!found?.length) out.push(inconsistent(item.key, "no source"));
    for (const f of found ?? [])
      if (!documents.has(f.document))
        out.push(inconsistent(item.key, `source ${f.document} is not one of the exam's documents`));
  }
  for (const d of sources.documents) {
    if (!d.raw) continue;
    const file = library.rawFile(series, d.raw);
    if (!file) {
      out.push(inconsistent(at, `the copy of ${d.id} (${d.raw}) is missing`));
      continue;
    }
    if (d.sha256 && (await hashFile(file)).sha256 !== d.sha256)
      out.push(inconsistent(at, `the copy of ${d.id} (${d.raw}) changed since it was read`));
  }
  for (const c of sources.checks)
    if (c.passed !== c.of) out.push(inconsistent(at, `check ${c.id}: ${c.passed} of ${c.of}`));
  return out;
}

/** An exam's texts in one edition that do not match it. */
function localeExamProblems(exam: Exam, locale: LocaleExam, edition: string): CourseProblem[] {
  const out: CourseProblem[] = [];
  const at = `${edition} ${exam.key}`;
  if (locale.exam !== exam.key) out.push(inconsistent(at, `locale is for ${locale.exam}`));
  for (const s of exam.sections)
    if (!locale.sections[s.key]) out.push(inconsistent(at, `no title for ${s.key}`));
  for (const m of exam.modules ?? [])
    if (!locale.modules?.[m.id]) out.push(inconsistent(at, `no title for module ${m.id}`));
  for (const t of exam.thresholds)
    if (!locale.thresholds[t.id]) out.push(inconsistent(at, `no title for pass mark ${t.id}`));
  const items = new Set(exam.items.map((i) => i.key as string));
  for (const k of Object.keys(locale.items))
    if (!items.has(k))
      out.push(inconsistent(at, `locale texts for ${k}, not a question of the exam`));
  return out;
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
    exams: 0,
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
      report.problems.push(
        problem("unreadable", what, error instanceof Error ? error.message : String(error)),
      );
      return undefined;
    }
  };
  const index = await guard("course.json", () => library.courseIndex(series, course));
  if (!index) return report;
  if (!editions.length)
    report.problems.push(problem("noEdition", course, "no edition (locale course.json) installed"));
  const media = new Set<string>();
  const listed = new Set<string>();
  report.units = index.units.length;
  for (const unit of index.units) {
    for (const key of unit.lessons) {
      if (listed.has(key)) report.problems.push(inconsistent(key, "listed twice in course.json"));
      listed.add(key);
      const lesson = await guard(key, () => library.lesson(series, key as LessonKey));
      if (!lesson) continue;
      report.lessons++;
      if (lesson.key !== key)
        report.problems.push(inconsistent(key, `the file holds ${lesson.key}`));
      if (lesson.unit !== unit.key)
        report.problems.push(inconsistent(key, `unit ${lesson.unit}, listed in ${unit.key}`));
      report.vocab += lesson.vocab.length;
      mediaPaths(lesson, media);
      for (const { exercise } of lesson.pages) {
        report.exercises[exercise.type] = (report.exercises[exercise.type] ?? 0) + 1;
        report.items += exercise.items.length;
        if (exercise.fingerprint !== fingerprint(exercise))
          report.problems.push(
            inconsistent(exercise.key, "fingerprint does not match its content"),
          );
        report.problems.push(...answerProblems(exercise));
      }
      for (const edition of editions) {
        const locale = await guard(`${edition} ${key}`, () =>
          library.localeLesson(series, key as LessonKey, edition),
        );
        if (!locale) {
          report.problems.push(problem("noLocale", `${edition} ${key}`, "no locale file"));
          continue;
        }
        mediaPaths(locale, media);
        const found = localeProblems(lesson, locale, edition);
        report.problems.push(...found.problems);
        report.notes.push(...found.notes);
      }
    }
  }
  for (const key of index.exams) {
    const exam = await guard(key, () => library.exam(series, key as ExamKey));
    if (!exam) continue;
    report.exams++;
    report.items += exam.items.length;
    mediaPaths(exam, media);
    report.problems.push(...examProblems(exam, key));
    const sources = await guard(`${key} sources`, () =>
      library.examSources(series, key as ExamKey),
    );
    if (sources) report.problems.push(...(await sourcesProblems(library, series, exam, sources)));
    for (const edition of editions) {
      const locale = await guard(`${edition} ${key}`, () =>
        library.localeExam(series, key as ExamKey, edition),
      );
      if (!locale) {
        report.problems.push(problem("noLocale", `${edition} ${key}`, "no locale file"));
        continue;
      }
      report.problems.push(...localeExamProblems(exam, locale, edition));
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
  const files = existsSync(dir) ? readdirSync(dir) : [];
  for (const file of files.filter((f) => f.endsWith(".json"))) {
    const key = `${series}/${course}/${file.slice(0, -5)}`;
    if (!listed.has(key))
      report.problems.push(inconsistent(key, "lesson file not listed in course.json"));
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
      if (report.media.missing <= 20)
        report.problems.push(problem("missingMedia", path, "missing media"));
    }
  }
  return report;
}
