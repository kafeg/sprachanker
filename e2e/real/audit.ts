// A content audit of one installed course (the course-check skill): its canonical and locale files read
// for what a learner would trip over — entities and markup left in text, broken or zero-width
// characters, empty strings and options, media files missing, unknown exercises, choices without an
// answer or with a duplicate option, exercises and words without their locale text. Read-only; one
// finding per line (severity, where, what, a sample).
//   bun e2e/real/audit.ts <library> <series> <course> <edition>
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Lesson, LocaleLesson } from "@sprachanker/schema";

const [library, series, course, edition] = process.argv.slice(2);
if (!library || !series || !course || !edition) {
  console.error("usage: bun e2e/real/audit.ts <library> <series> <course> <edition>");
  process.exit(2);
}
const root = join(library, series);
const findings: string[] = [];
const add = (severity: "high" | "med" | "low", where: string, what: string, sample = "") =>
  findings.push([severity, where, what, sample.replace(/\s+/g, " ").slice(0, 160)].join("\t"));
/** Fields that hold ids or keys, never text. */
const NOT_TEXT = new Set([
  "key",
  "fingerprint",
  "sourceId",
  "id",
  "optionIds",
  "ruleIds",
  "newWords",
]);
/** Fields that hold a media path. */
const MEDIA = new Set(["image", "video", "audio", "hd", "sd", "subtitles", "path", "answerAudio"]);

function text(value: string, path: string, html: boolean, where: string) {
  if (value === "") add("low", where, `empty string at ${path}`);
  // HTML keeps its own escapes; any other entity is left over.
  const entities = value.match(/&(?:[a-z]+|#\d+|#x[0-9a-f]+);/gi) ?? [];
  if (entities.some((e) => !html || !/^&(amp|lt|gt|quot);$/.test(e)))
    add("high", where, `entity left at ${path}`, value);
  if (!html && /<\/?[a-z][^>]*>/i.test(value))
    add("high", where, `markup in plain text at ${path}`, value);
  if (/[​﻿]/.test(value)) add("med", where, `zero-width character at ${path}`, value);
  if (!html && /\S {2,}\S/.test(value)) add("low", where, `double space at ${path}`, value);
  if (!html && value !== value.trim() && !/\.segments\[/.test(path))
    add("low", where, `untrimmed at ${path}`, value);
  if (/\b(undefined|NaN)\b|\[object /.test(value))
    add("high", where, `placeholder at ${path}`, value);
  if (/\?\?|�/.test(value)) add("med", where, `broken character at ${path}`, value);
  if (html && /<p>\s*<\/p>|<strong>\s*<\/strong>/.test(value))
    add("low", where, `empty element at ${path}`, value);
}

/** Every string under a value, with its path; media paths checked on disk. */
function walk(value: unknown, path: string, html: boolean, where: string) {
  if (typeof value === "string") text(value, path, html || /Html$/.test(path), where);
  else if (Array.isArray(value))
    value.forEach((v, i) => {
      walk(v, `${path}[${i}]`, html, where);
    });
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) {
      if (NOT_TEXT.has(k)) continue;
      if (MEDIA.has(k) && typeof v === "string") {
        if (v.startsWith("media/") && !existsSync(join(root, v)))
          add("high", where, `missing media ${path}.${k}`, v);
        continue;
      }
      walk(v, `${path}.${k}`, html || /Html$/.test(k), where);
    }
}

const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const lessons = join(root, "canonical", course, "lessons");
const locales = join(root, "locale", edition, course, "lessons");
const types = new Map<string, number>();
let exercises = 0;
let items = 0;
for (const file of readdirSync(lessons)
  .filter((f) => f.endsWith(".json"))
  .sort()) {
  const name = file.slice(0, -5);
  const lesson = Lesson.parse(read(join(lessons, file)));
  if (!existsSync(join(locales, file))) {
    add("high", name, "no locale file");
    continue;
  }
  const locale = LocaleLesson.parse(read(join(locales, file)));
  walk(lesson, "canonical", false, name);
  walk(locale, "locale", false, name);
  for (const { exercise } of lesson.pages) {
    exercises++;
    types.set(exercise.type, (types.get(exercise.type) ?? 0) + 1);
    const where = `${name} ${exercise.key.split("/").pop()} ${exercise.type}`;
    if (exercise.type === "unknown") add("high", where, "unknown exercise");
    const own = locale.exercises?.[exercise.key];
    if (!own) add("high", where, "exercise without its locale text");
    else if (!own.instructionHtml) add("med", where, "exercise without an instruction");
    for (const item of exercise.items) {
      items++;
      if (!("options" in item) || !Array.isArray(item.options)) continue;
      const at = `${where} ${item.key.split("#").pop()}`;
      const texts = item.options.flatMap((o) => ("text" in o && o.text ? [o.text] : []));
      if (new Set(texts).size !== texts.length)
        add("high", at, "the same option twice", texts.join(" | "));
      if (item.options.length < 2) add("med", at, "a choice of fewer than two");
    }
  }
  for (const word of lesson.vocab)
    if (!locale.vocab[word.key]?.translation)
      add("med", name, `a word without its translation: ${word.key}`);
  for (const key of Object.keys(locale.exercises ?? {}))
    if (!lesson.pages.some((p) => p.exercise.key === key))
      add("med", name, `locale text of an exercise not in the lesson: ${key}`);
}
console.log(findings.join("\n"));
console.error(
  `exercises ${exercises}, items ${items}; ${JSON.stringify(Object.fromEntries(types))}; findings ${findings.length}`,
);
