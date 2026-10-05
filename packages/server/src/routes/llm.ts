// /api/llm: provider setup, connection test and lesson help. Mounted by app.ts; removing this module
// and that mount removes the LLM features from the API.
import { LlmError, ProviderId } from "@sprachanker/llm";
import { LessonKey } from "@sprachanker/schema";
import { Hono } from "hono";
import { streamText } from "hono/streaming";
import { z } from "zod";
import { type Llm, LlmSetupError } from "../services/llm.ts";
import { Edition, Series, zod } from "../validate.ts";

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

export function llmRoutes(llm: Llm) {
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
          language: z.string().regex(/^[a-z]{2,3}$/),
        }),
      ),
      async (c) => {
        // Wait for the first chunk so that setup and connection errors still get a JSON response.
        let chunks: AsyncIterator<string>;
        let first: IteratorResult<string>;
        try {
          chunks = (await llm.explain(c.req.valid("json"), c.req.raw.signal))[
            Symbol.asyncIterator
          ]();
          first = await chunks.next();
        } catch (error) {
          const { status, ...body } = failure(error);
          return c.json(body, status);
        }
        return streamText(c, async (stream) => {
          for (let next = first; !next.done; next = await chunks.next()) {
            await stream.write(next.value);
          }
        });
      },
    );
}
