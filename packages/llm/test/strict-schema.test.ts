// Every task's JSON Schema as sent strict (OpenAI's structured outputs) is one strict mode takes.
import { expect, test } from "bun:test";
import { fixture } from "@sprachanker/course-fixture";
import { chatBody, strictSchema } from "../src/client.ts";
import { PROVIDERS } from "../src/providers.ts";
import { type StructuredTask, structuredRequest } from "../src/structured.ts";
import { checkSpeakingTask } from "../src/tasks/check-speaking.ts";
import { checkWritingTask } from "../src/tasks/check-writing.ts";
import { examConversationTask } from "../src/tasks/exam-conversation.ts";
import { rateExamAnswerTask } from "../src/tasks/rate-exam-answer.ts";
import { sceneSetupTask, sceneSummaryTask, sceneTurnTask } from "../src/tasks/scene.ts";
import { wordExamplesTask } from "../src/tasks/word-examples.ts";

const RU_DE = { language: "ru", target: "de" } as const;
const lesson = { title: "Begrüßung", goals: [], vocab: [], grammarHtml: [] };
const setup = { title: "T", situation: "S", partner: "P", goals: ["G"], opening: "Hallo!" };
const speaking = fixture.lessons
  .flatMap((l) => l.pages)
  .flatMap((p) => ("exercise" in p ? [p.exercise] : []))
  .find((e) => e.type === "speech_selfrate");
if (!speaking) throw new Error("no speaking exercise in the fixture");

/** Every task answered in JSON. */
const TASKS: StructuredTask<unknown>[] = [
  checkWritingTask({ ...RU_DE, lesson, text: "Ich heiße Anna." }),
  checkSpeakingTask({ ...RU_DE, lesson, exercise: speaking, index: 0, transcript: "Hallo" }),
  examConversationTask({ ...RU_DE, exam: "E", part: "Teil 1", task: [], partner: "", history: [] }),
  rateExamAnswerTask({ ...RU_DE, exam: "E", task: [], criteria: [], samples: [], answer: "A" }),
  sceneSetupTask({ ...RU_DE, lesson }),
  sceneTurnTask({ ...RU_DE, lesson, setup, history: [], message: "Hallo" }),
  sceneSummaryTask({ ...RU_DE, lesson, setup, turns: [], goalsMet: [] }),
  wordExamplesTask({ ...RU_DE, words: [], known: [] }),
];

/** The keywords strict mode takes. */
const STRICT = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "anyOf",
  "description",
  "title",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minItems",
  "maxItems",
  "pattern",
  "format",
  "$ref",
  "$defs",
]);

/** What strict mode would refuse in a schema, by path. */
function unstrict(node: unknown, path = "$"): string[] {
  if (!node || typeof node !== "object") return [];
  const schema = node as Record<string, unknown>;
  const problems = Object.keys(schema)
    .filter((k) => !STRICT.has(k))
    .map((k) => `${path}: ${k}`);
  const properties = schema.properties as Record<string, unknown> | undefined;
  if (schema.type === "object") {
    if (schema.additionalProperties !== false) problems.push(`${path}: additionalProperties`);
    const keys = Object.keys(properties ?? {}).sort();
    if (JSON.stringify([...((schema.required as string[]) ?? [])].sort()) !== JSON.stringify(keys))
      problems.push(`${path}: not every property required`);
  }
  for (const [k, v] of Object.entries(properties ?? {}))
    problems.push(...unstrict(v, `${path}.${k}`));
  for (const [k, v] of Object.entries((schema.$defs as Record<string, unknown>) ?? {}))
    problems.push(...unstrict(v, `${path}.$defs.${k}`));
  if (schema.items) problems.push(...unstrict(schema.items, `${path}[]`));
  for (const [i, v] of ((schema.anyOf as unknown[]) ?? []).entries())
    problems.push(...unstrict(v, `${path}|${i}`));
  return problems;
}

test.each(TASKS.map((t) => [t.name, t] as const))(
  "%s: its schema as sent strict is one strict mode takes",
  (_, task) => {
    const body = chatBody({ ...structuredRequest(task), model: "gpt-4.1" }, PROVIDERS.openai);
    const format = body.response_format?.json_schema;
    expect(format?.strict).toBe(true);
    expect(unstrict(format?.schema)).toEqual([]);
  },
);

test("strictSchema: the keywords strict mode refuses go at every depth, never a property so named", () => {
  expect(
    strictSchema({
      type: "object",
      properties: {
        minLength: { type: "string", minLength: 1, maxLength: 9, enum: [{ maxLength: 1 }] },
        list: { type: "array", items: { type: "string", maxLength: 3 }, uniqueItems: true },
      },
      required: ["minLength", "list"],
      additionalProperties: false,
    }),
  ).toEqual({
    type: "object",
    properties: {
      minLength: { type: "string", enum: [{ maxLength: 1 }] },
      list: { type: "array", items: { type: "string" } },
    },
    required: ["minLength", "list"],
    additionalProperties: false,
  });
});
