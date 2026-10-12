// Every shape a run's JSON columns (`plan_json`, `result_json`) were ever stored in
// (test/stored-runs/runs.json, synthetic) must keep reading, as event payloads do.
import { expect, test } from "bun:test";
import type { z } from "zod";
import { ExamPlan, ExamResult, LessonResult, SceneSetup } from "../src/index.ts";
import stored from "./stored-runs/runs.json";

/** Each stored column by the run kind it belongs to, with the schema it is read with. */
const COLUMNS: Record<keyof typeof stored, z.ZodType> = {
  "lesson.result": LessonResult,
  "scene.plan": SceneSetup,
  "exam.plan": ExamPlan,
  "exam.result": ExamResult,
};

for (const [column, shapes] of Object.entries(stored))
  test(`${column}: every stored shape still reads, whole`, () => {
    const schema = COLUMNS[column as keyof typeof stored];
    for (const { since, value } of shapes as Array<{ since: string; value: unknown }>) {
      const read = schema.safeParse(value);
      expect(read.success, `${column} stored since ${since}: ${read.error?.message}`).toBe(true);
      expect(read.data).toEqual(value);
    }
  });
