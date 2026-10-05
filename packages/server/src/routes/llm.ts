// /api/llm: provider setup, LM Studio, connection test, mistake explanations and the lesson tutor.
// Mounted by app.ts; removing this module and that mount removes the LLM features from the API.
import { LlmError, LMSTUDIO_RECOMMENDED, ProviderId } from "@sprachanker/llm";
import { LessonKey } from "@sprachanker/schema";
import { type Context, Hono } from "hono";
import { streamText } from "hono/streaming";
import { z } from "zod";
import { type Llm, LlmSetupError } from "../services/llm.ts";
import type { Practice } from "../services/practice.ts";
import type { Scenes } from "../services/scene.ts";
import type { Tutor } from "../services/tutor.ts";
import { Edition, Series, zod } from "../validate.ts";

const Language = z.string().regex(/^[a-z]{2,3}$/);

/** Every LLM request is about a lesson, answered in the learner's language. */
const LessonRequest = z.object({
  series: Series,
  lessonKey: LessonKey,
  edition: Edition,
  language: Language,
});

const ExplainBody = LessonRequest.extend({
  exerciseKey: z.string().max(300),
  index: z.number().int().nonnegative(),
  answer: z.unknown().optional(),
});

const ReviewBody = LessonRequest;

const SceneLine = LessonRequest.extend({ text: z.string().trim().min(1).max(1000) });

const WritingBody = LessonRequest.extend({ text: z.string().trim().min(1).max(4000) });

const TutorBody = LessonRequest.extend({
  exerciseKey: z.string().max(300).optional(),
  message: z.string().trim().min(1).max(4000),
});

const Url = z
  .string()
  .max(500)
  .regex(/^https?:\/\/\S+$/);

/** LLM failures as responses: setup problems are 409, provider problems 502. */
function failure(error: unknown) {
  if (error instanceof LlmSetupError) return { status: 409 as const, error: error.message };
  if (error instanceof LlmError)
    return { status: 502 as const, error: `llm_${error.code}`, message: error.message };
  throw error;
}

/**
 * Streams model text. Waits for the first chunk, so that setup and connection errors still get a
 * JSON response; a learner closing the request stops the generation (the signal reaches the provider).
 */
async function streamReply(c: Context, start: () => Promise<AsyncIterable<string>>) {
  let chunks: AsyncIterator<string>;
  let first: IteratorResult<string>;
  try {
    chunks = (await start())[Symbol.asyncIterator]();
    first = await chunks.next();
  } catch (error) {
    const { status, ...body } = failure(error);
    return c.json(body, status);
  }
  return streamText(c, async (stream) => {
    try {
      for (let next = first; !next.done; next = await chunks.next()) await stream.write(next.value);
    } finally {
      await chunks.return?.();
    }
  });
}

/** Runs a call and turns setup and provider failures into their JSON responses. */
async function jsonOrFailure<T>(c: Context, run: () => Promise<T>) {
  try {
    return c.json(await run());
  } catch (error) {
    const { status, ...body } = failure(error);
    return c.json(body, status);
  }
}

export function llmRoutes(llm: Llm, tutor: Tutor, practice: Practice, scenes: Scenes) {
  return (
    new Hono()
      .get("/", (c) => c.json(llm.state()))
      .put(
        "/route",
        zod(
          "json",
          z.object({
            provider: ProviderId.nullable(),
            model: z.string().min(1).max(300).nullable(),
          }),
        ),
        (c) => {
          const { provider, model } = c.req.valid("json");
          llm.setRoute(provider, model);
          return c.json(llm.state());
        },
      )
      .put(
        "/providers/:id",
        zod("param", z.object({ id: ProviderId })),
        zod(
          "json",
          z.object({
            baseUrl: Url.nullable().optional(),
            apiKey: z.string().trim().min(1).max(500).nullable().optional(),
          }),
        ),
        async (c) => {
          await llm.setProvider(c.req.valid("param").id, c.req.valid("json"));
          return c.json(llm.state());
        },
      )
      .get("/models", zod("query", z.object({ provider: ProviderId })), (c) =>
        jsonOrFailure(c, () => llm.models(c.req.valid("query").provider, c.req.raw.signal)),
      )
      .post("/explain", zod("json", ExplainBody), (c) =>
        streamReply(c, () => llm.explain(c.req.valid("json"), c.req.raw.signal)),
      )
      // Prompt viewer: the exact request a task would send now (nothing is sent).
      .post("/explain/prompt", zod("json", ExplainBody), (c) =>
        jsonOrFailure(c, () => llm.explainPrompt(c.req.valid("json"))),
      )
      .get("/prompts", zod("query", z.object({ language: Language, target: Language })), (c) => {
        const { language, target } = c.req.valid("query");
        return c.json(llm.prompts(language, target));
      })
      // LM Studio: what it has and runs; start its server, download suggested models into it.
      .get("/lmstudio", async (c) => c.json(await llm.lmStudioStatus()))
      .post("/lmstudio/start", (c) => jsonOrFailure(c, () => llm.lmStudioStart()))
      .post(
        "/lmstudio/download",
        zod("json", z.object({ model: z.enum(LMSTUDIO_RECOMMENDED.map((m) => m.key)) })),
        (c) => jsonOrFailure(c, () => llm.lmStudioDownload(c.req.valid("json").model)),
      )
      // Scenes: a role-play on the lesson's topic.
      .get("/scene", zod("query", z.object({ lessonKey: LessonKey })), (c) =>
        c.json({ scene: scenes.state(c.req.valid("query").lessonKey) }),
      )
      .post("/scene/start", zod("json", ReviewBody), (c) =>
        jsonOrFailure(c, () => scenes.start(c.req.valid("json"), c.req.raw.signal)),
      )
      .post("/scene/turn", zod("json", SceneLine), (c) =>
        jsonOrFailure(c, () => scenes.turn(c.req.valid("json"), c.req.raw.signal)),
      )
      .post("/scene/prompt", zod("json", SceneLine.extend({ text: z.string().max(1000) })), (c) =>
        jsonOrFailure(c, () => scenes.prompt(c.req.valid("json"))),
      )
      .post("/scene/end", zod("json", z.object({ lessonKey: LessonKey })), (c) => {
        scenes.end(c.req.valid("json").lessonKey);
        return c.json({ ok: true as const });
      })
      // Session review of a lesson's latest run.
      .get("/review", zod("query", z.object({ lessonKey: LessonKey })), (c) =>
        c.json(practice.review.state(c.req.valid("query").lessonKey)),
      )
      .post("/review", zod("json", ReviewBody), (c) =>
        jsonOrFailure(c, () => practice.review.create(c.req.valid("json"), c.req.raw.signal)),
      )
      .post("/review/prompt", zod("json", ReviewBody), (c) =>
        jsonOrFailure(c, () => practice.review.prompt(c.req.valid("json"))),
      )
      // Writing task of a lesson: the task and attempts; a check stores its verdict.
      .get(
        "/writing",
        zod("query", z.object({ series: Series, lessonKey: LessonKey, edition: Edition })),
        async (c) => {
          const { series, lessonKey, edition } = c.req.valid("query");
          return c.json(await practice.writing.state(series, lessonKey, edition));
        },
      )
      .post("/writing", zod("json", WritingBody), (c) =>
        jsonOrFailure(c, () => practice.writing.check(c.req.valid("json"), c.req.raw.signal)),
      )
      .post(
        "/writing/prompt",
        zod("json", WritingBody.extend({ text: z.string().max(4000) })),
        (c) => jsonOrFailure(c, () => practice.writing.prompt(c.req.valid("json"))),
      )
      .get("/tutor", zod("query", z.object({ lessonKey: LessonKey })), (c) =>
        c.json({ turns: tutor.history(c.req.valid("query").lessonKey) }),
      )
      .post("/tutor", zod("json", TutorBody), (c) =>
        streamReply(c, () => tutor.send(c.req.valid("json"), c.req.raw.signal)),
      )
      .post(
        "/tutor/context",
        zod("json", TutorBody.extend({ message: z.string().max(4000) })),
        async (c) => c.json(await tutor.usage(c.req.valid("json"))),
      )
      .post(
        "/tutor/prompt",
        zod("json", TutorBody.extend({ message: z.string().max(4000) })),
        (c) => jsonOrFailure(c, () => tutor.prompt(c.req.valid("json"))),
      )
      .post("/tutor/reset", zod("json", z.object({ lessonKey: LessonKey })), (c) => {
        tutor.reset(c.req.valid("json").lessonKey);
        return c.json({ ok: true as const });
      })
  );
}
