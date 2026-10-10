// Generates the committed JSON Schemas of stored file formats (10, "Schema drift").
// Usage: bun run --filter @sprachanker/schema gen   (the drift test fails until you do)
import { join } from "node:path";
import { z } from "zod";
import {
  CourseIndex,
  Enrichment,
  Exam,
  Lesson,
  LocaleCourse,
  LocaleExam,
  LocaleLesson,
  RulesRegistry,
} from "../src/index.ts";

/** File name → schema of every stored file format. */
const FORMATS: Record<string, z.ZodType> = {
  "course-index.schema.json": CourseIndex,
  "lesson.schema.json": Lesson,
  "exam.schema.json": Exam,
  "locale-course.schema.json": LocaleCourse,
  "locale-lesson.schema.json": LocaleLesson,
  "locale-exam.schema.json": LocaleExam,
  "rules-registry.schema.json": RulesRegistry,
  "enrichment.schema.json": Enrichment,
};

export const JSON_SCHEMA_DIR = join(import.meta.dir, "../json-schema");

export function jsonSchemas(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(FORMATS).map(([file, schema]) => [
      file,
      `${JSON.stringify(z.toJSONSchema(schema, { io: "input" }), null, 2)}\n`,
    ]),
  );
}

if (import.meta.main) {
  for (const [file, text] of Object.entries(jsonSchemas())) {
    await Bun.write(join(JSON_SCHEMA_DIR, file), text);
  }
  console.log(`wrote ${Object.keys(FORMATS).length} schemas to ${JSON_SCHEMA_DIR}`);
}
