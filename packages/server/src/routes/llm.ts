// /api/llm: provider setup, connection test, mistake explanations and the lesson tutor. Mounted by app.ts; removing this module
// and that mount removes the LLM features from the API.
import { LlmError, ProviderId } from "@sprachanker/llm";
import { LessonKey } from "@sprachanker/schema";
import { type Context, Hono } from "hono";
import { streamText } from "hono/streaming";
import { z } from "zod";
import { type Llm, LlmSetupError } from "../services/llm.ts";
import type { Tutor } from "../services/tutor.ts";
import { Edition, Series, zod } from "../validate.ts";

const Language = z.string().regex(/^[a-z]{2,3}$/);

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

export function llmRoutes(llm: Llm, tutor: Tutor) {
  return new Hono()
    .get("/", (c) => c.json(llm.state()))
    .put(
      "/route",
      zod(
        "json",
        z.object({ provider: ProviderId.nullable(), model: z.string().min(1).max(300).nullable() }),
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
    .get("/models", zod("query", z.object({ provider: ProviderId })), async (c) => {
      try {
        return c.json(await llm.models(c.req.valid("query").provider, c.req.raw.signal));
      } catch (error) {
        const { status, ...body } = failure(error);
        return c.json(body, status);
      }
    })
    .post(
      "/explain",
      zod(
        "json",
        z.object({
          series: Series,
          lessonKey: LessonKey,
          edition: Edition,
          exerciseKey: z.string().max(300),
          index: z.number().int().nonnegative(),
          answer: z.unknown().optional(),
          language: Language,
        }),
      ),
      (c) => streamReply(c, () => llm.explain(c.req.valid("json"), c.req.raw.signal)),
    )
    .get("/tutor", zod("query", z.object({ lessonKey: LessonKey })), (c) =>
      c.json({ turns: tutor.history(c.req.valid("query").lessonKey) }),
    )
    .post(
      "/tutor",
      zod(
        "json",
        z.object({
          series: Series,
          lessonKey: LessonKey,
          edition: Edition,
          exerciseKey: z.string().max(300).optional(),
          message: z.string().trim().min(1).max(4000),
          language: Language,
        }),
      ),
      (c) => streamReply(c, () => tutor.send(c.req.valid("json"), c.req.raw.signal)),
    )
    .post("/tutor/reset", zod("json", z.object({ lessonKey: LessonKey })), (c) => {
      tutor.reset(c.req.valid("json").lessonKey);
      return c.json({ ok: true as const });
    });
}
