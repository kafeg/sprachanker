// /api/llm: provider setup, LM Studio, connection test, mistake explanations and the lesson tutor.
// Mounted by app.ts; removing this module and that mount removes the LLM features from the API.
import { LlmError, LMSTUDIO_RECOMMENDED, ProviderId } from "@sprachanker/llm";
import {
  EditionId,
  Lang,
  LessonKey,
  MESSAGE_MAX,
  SeriesKey,
  STREAM_ERROR,
  Ulid,
  WRITING_MAX,
} from "@sprachanker/schema";
import { type Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamText } from "hono/streaming";
import { z } from "zod";
import { ServiceError } from "../errors.ts";
import type { Explain } from "../services/explain.ts";
import { type Llm, PROMPT_TASKS } from "../services/llm.ts";
import type { Scenes } from "../services/scene.ts";
import type { Tutor } from "../services/tutor.ts";
import type { Writing } from "../services/writing.ts";
import { zod } from "../validate.ts";

/** Every LLM request is about a lesson, answered in the learner's language. */
const LessonRequest = z.object({
  series: SeriesKey,
  lessonKey: LessonKey,
  edition: EditionId,
  language: Lang,
});

const ExplainBody = LessonRequest.extend({
  exerciseKey: z.string().max(300),
  index: z.number().int().nonnegative(),
  answer: z.unknown().optional(),
  /** The lesson run and the attempt explained: the explanation is kept there. */
  runId: Ulid.optional(),
  attempt: z.number().int().positive().optional(),
});

const SceneLine = LessonRequest.extend({ text: z.string().trim().min(1).max(MESSAGE_MAX) });

// The model checks this much of a text: a longer one would be marked wrong past the cut.
const WritingBody = LessonRequest.extend({ text: z.string().trim().min(1).max(WRITING_MAX) });

const TutorBody = LessonRequest.extend({
  exerciseKey: z.string().max(300).optional(),
  message: z.string().trim().min(1).max(MESSAGE_MAX),
  /** Ends the current chat first: the message opens a new one. */
  newChat: z.boolean().optional(),
});

const ChatParam = z.object({ id: Ulid });

const Url = z
  .string()
  .max(500)
  .regex(/^https?:\/\/\S+$/);

/** LLM failures as responses: a service's own (setup: 409), provider problems 502. */
function failure(error: unknown) {
  if (error instanceof ServiceError) return { status: error.status, error: error.message };
  if (error instanceof LlmError)
    return { status: 502 as const, error: `llm_${error.code}`, message: error.message };
  throw error;
}

/**
 * Streams model text. Waits for the first chunk, so that setup and connection errors — and a model
 * that answers nothing — still get a JSON response; a learner closing the request stops the
 * generation (the signal reaches the provider). A failure after the first chunk ends the text with
 * `STREAM_ERROR` and the error, so the client does not take the part for the whole.
 */
async function streamReply(c: Context, start: () => Promise<AsyncIterable<string>>) {
  let chunks: AsyncIterator<string>;
  let first: IteratorResult<string>;
  try {
    chunks = (await start())[Symbol.asyncIterator]();
    first = await chunks.next();
    if (first.done) throw new LlmError("bad_response", "the model answered nothing");
  } catch (error) {
    const { status, ...body } = failure(error);
    return c.json(body, status);
  }
  return streamText(c, async (stream) => {
    try {
      // Writes to a stream the learner closed do not fail: stop reading the model instead, so the
      // task sees the reply cut short (an explanation is then not kept).
      let next: IteratorResult<string> = first;
      for (; !next.done && !stream.aborted; next = await chunks.next())
        await stream.write(next.value);
    } catch (error) {
      if (!(error instanceof LlmError || error instanceof ServiceError)) console.error(error);
      const body =
        error instanceof LlmError || error instanceof ServiceError
          ? (({ status: _, ...rest }) => rest)(failure(error))
          : { error: "server_error" };
      if (!stream.aborted) await stream.write(STREAM_ERROR + JSON.stringify(body));
    } finally {
      await chunks.return?.();
    }
  });
}

export function llmRoutes(
  llm: Llm,
  explain: Explain,
  tutor: Tutor,
  writing: Writing,
  scenes: Scenes,
) {
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
      .get("/models", zod("query", z.object({ provider: ProviderId })), async (c) =>
        c.json(await llm.models(c.req.valid("query").provider, c.req.raw.signal)),
      )
      .post("/explain", zod("json", ExplainBody), (c) =>
        streamReply(c, () => explain.stream(c.req.valid("json"), c.req.raw.signal)),
      )
      .get("/explanations", zod("query", z.object({ lessonKey: LessonKey, runId: Ulid })), (c) => {
        const { lessonKey, runId } = c.req.valid("query");
        return c.json({ explanations: explain.list(lessonKey, runId) });
      })
      // Prompt viewer: the exact request a task would send now (nothing is sent).
      .post("/explain/prompt", zod("json", ExplainBody), async (c) =>
        c.json(await explain.prompt(c.req.valid("json"))),
      )
      .get("/prompts", zod("query", z.object({ language: Lang, target: Lang })), (c) => {
        const { language, target } = c.req.valid("query");
        return c.json(llm.prompts(language, target));
      })
      // The learner's own system prompt of a task ({language}, {target} filled in); null: standing rules.
      .put(
        "/prompts/:task",
        zod("param", z.object({ task: z.enum(PROMPT_TASKS) })),
        zod("json", z.object({ template: z.string().max(20_000).nullable() })),
        (c) => {
          llm.setPrompt(c.req.valid("param").task, c.req.valid("json").template);
          return c.json({ ok: true as const });
        },
      )
      // LM Studio: what it has and runs; start its server, download suggested models into it.
      .get("/lmstudio", async (c) => c.json(await llm.lmStudioStatus()))
      .post("/lmstudio/start", async (c) => c.json(await llm.lmStudioStart()))
      .post(
        "/lmstudio/download",
        zod("json", z.object({ model: z.enum(LMSTUDIO_RECOMMENDED.map((m) => m.key)) })),
        async (c) => c.json(await llm.lmStudioDownload(c.req.valid("json").model)),
      )
      // Scenes: a role-play on the lesson's topic.
      .get("/scene", zod("query", z.object({ lessonKey: LessonKey })), (c) =>
        c.json({
          scenes: scenes.list(c.req.valid("query").lessonKey),
          pending: scenes.pending(c.req.valid("query").lessonKey),
        }),
      )
      .post("/scene/start", zod("json", LessonRequest), async (c) =>
        c.json(await scenes.start(c.req.valid("json"))),
      )
      .post("/scene/turn", zod("json", SceneLine), async (c) =>
        c.json(await scenes.turn(c.req.valid("json"))),
      )
      .post(
        "/scene/prompt",
        zod("json", SceneLine.extend({ text: z.string().max(MESSAGE_MAX) })),
        async (c) => c.json(await scenes.prompt(c.req.valid("json"))),
      )
      // Writing task of a lesson: the task and attempts; a check stores its verdict.
      .get(
        "/writing",
        zod("query", z.object({ series: SeriesKey, lessonKey: LessonKey, edition: EditionId })),
        async (c) => {
          const { series, lessonKey, edition } = c.req.valid("query");
          return c.json(await writing.state(series, lessonKey, edition));
        },
      )
      .post("/writing", zod("json", WritingBody), async (c) =>
        c.json(await writing.check(c.req.valid("json"))),
      )
      .post(
        "/writing/prompt",
        zod("json", WritingBody.extend({ text: z.string().max(WRITING_MAX) })),
        async (c) => c.json(await writing.prompt(c.req.valid("json"))),
      )
      .get("/tutor", zod("query", z.object({ lessonKey: LessonKey })), (c) =>
        c.json({ turns: tutor.history(c.req.valid("query").lessonKey) }),
      )
      .post("/tutor", zod("json", TutorBody), (c) =>
        streamReply(c, () => tutor.send(c.req.valid("json"), c.req.raw.signal)),
      )
      .post(
        "/tutor/context",
        zod("json", TutorBody.extend({ message: z.string().max(MESSAGE_MAX) })),
        async (c) => c.json(await tutor.usage(c.req.valid("json"))),
      )
      .post(
        "/tutor/prompt",
        zod("json", TutorBody.extend({ message: z.string().max(MESSAGE_MAX) })),
        async (c) => c.json(await tutor.prompt(c.req.valid("json"))),
      )
      .post("/tutor/reset", zod("json", z.object({ lessonKey: LessonKey })), (c) => {
        tutor.reset(c.req.valid("json").lessonKey);
        return c.json({ ok: true as const });
      })
      .get("/tutor/chats", zod("query", z.object({ lessonKey: LessonKey })), (c) =>
        c.json({ chats: tutor.chats(c.req.valid("query").lessonKey) }),
      )
      .get(
        "/tutor/chats/:id",
        zod("param", ChatParam),
        zod("query", z.object({ lessonKey: LessonKey })),
        (c) => {
          const turns = tutor.chat(c.req.valid("query").lessonKey, c.req.valid("param").id);
          if (!turns) throw new ServiceError("no_such_chat", 404);
          return c.json({ turns });
        },
      )
      .delete(
        "/tutor/chats/:id",
        zod("param", ChatParam),
        zod("query", z.object({ lessonKey: LessonKey })),
        (c) => {
          if (!tutor.remove(c.req.valid("query").lessonKey, c.req.valid("param").id))
            throw new ServiceError("no_such_chat", 404);
          return c.json({ ok: true as const });
        },
      )
      // Setup and provider failures as their responses (the routes return their results only).
      .onError((error, c) => {
        if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
        if (error instanceof ServiceError || error instanceof LlmError) {
          const { status, ...body } = failure(error);
          return c.json(body, status);
        }
        throw error;
      })
  );
}
