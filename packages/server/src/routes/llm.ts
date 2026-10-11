// /api/llm: provider setup, LM Studio, connection test, mistake explanations and the lesson tutor.
// Mounted by app.ts; removing this module and that mount removes the LLM features from the API.
import { LlmError, LMSTUDIO_RECOMMENDED, PROMPT_TASKS, ProviderId } from "@sprachanker/llm";
import {
  CHAT_ID_HEADER,
  EditionId,
  ExamItemKey,
  Lang,
  LessonKey,
  MESSAGE_MAX,
  SeriesKey,
  STREAM_ERROR,
  Ulid,
  WRITING_MAX,
} from "@sprachanker/schema";
import { type Context, Hono } from "hono";
import { streamText } from "hono/streaming";
import { z } from "zod";
import { errorResponse, ServiceError } from "../errors.ts";
import { zod } from "../validate.ts";
import type { ProfileEnv } from "./env.ts";

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

/** An answer said aloud: what was heard, checked for the item in the lesson run it was given in. */
const SpeakingBody = LessonRequest.extend({
  exerciseKey: z.string().max(300),
  index: z.number().int().nonnegative(),
  transcript: z.string().trim().min(1).max(2000),
  runId: Ulid,
});

/** An exam's open answer to be rated by its criteria, the reasons in the learner's language. */
const ExamRatingBody = z.object({ runId: Ulid, itemKey: ExamItemKey, language: Lang });

/** A speaking part's next line: the learner's (none to open the part). */
const ConversationBody = ExamRatingBody.extend({
  text: z.string().trim().max(MESSAGE_MAX).optional(),
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

/** A message in the Tutor section: to one of its chats, or (no `chatId`) opening a new one. */
const SectionBody = z.object({
  chatId: Ulid.optional(),
  message: z.string().trim().min(1).max(MESSAGE_MAX),
  language: Lang,
});

const ChatParam = z.object({ id: Ulid });
/** Whose chats: a lesson's, or (none) the Tutor section's. */
const ChatsOf = z.object({ lessonKey: LessonKey.optional() });

const Url = z
  .string()
  .max(500)
  .regex(/^https?:\/\/\S+$/);

/** Failures as responses: provider problems 502, the rest as the app answers them (a service's
 *  own: setup 409); undefined for a server fault. */
function failure(error: unknown) {
  if (error instanceof LlmError)
    return {
      status: 502 as const,
      body: { error: `llm_${error.code}`, message: error.message },
    };
  return errorResponse(error);
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
    const response = failure(error);
    if (!response) throw error;
    return c.json(response.body, response.status);
  }
  return streamText(c, async (stream) => {
    try {
      // Writes to a stream the learner closed do not fail: stop reading the model instead, so the
      // task sees the reply cut short (an explanation is then not kept).
      let next: IteratorResult<string> = first;
      for (; !next.done && !stream.aborted; next = await chunks.next())
        await stream.write(next.value);
    } catch (error) {
      const response = failure(error);
      if (!response) console.error(error);
      const body = response?.body ?? { error: "server_error" };
      if (!stream.aborted) await stream.write(STREAM_ERROR + JSON.stringify(body));
    } finally {
      await chunks.return?.();
    }
  });
}

export function llmRoutes() {
  return (
    new Hono<ProfileEnv>()
      .get("/", (c) => c.json(c.var.s.llm.state()))
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
          c.var.s.llm.setRoute(provider, model);
          return c.json(c.var.s.llm.state());
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
          await c.var.s.llm.setProvider(c.req.valid("param").id, c.req.valid("json"));
          return c.json(c.var.s.llm.state());
        },
      )
      .get("/models", zod("query", z.object({ provider: ProviderId })), async (c) =>
        c.json(await c.var.s.llm.models(c.req.valid("query").provider, c.req.raw.signal)),
      )
      // The key's state where the provider tells it (OpenRouter), else null.
      .get("/key", zod("query", z.object({ provider: ProviderId })), async (c) =>
        c.json({
          key: await c.var.s.llm.keyState(c.req.valid("query").provider, c.req.raw.signal),
        }),
      )
      .post("/explain", zod("json", ExplainBody), (c) =>
        streamReply(c, () => c.var.s.explain.stream(c.req.valid("json"), c.req.raw.signal)),
      )
      .get("/explanations", zod("query", z.object({ lessonKey: LessonKey, runId: Ulid })), (c) => {
        const { lessonKey, runId } = c.req.valid("query");
        return c.json({ explanations: c.var.s.explain.list(lessonKey, runId) });
      })
      // Prompt viewer: the exact request a task would send now (nothing is sent).
      .post("/explain/prompt", zod("json", ExplainBody), async (c) =>
        c.json(await c.var.s.explain.prompt(c.req.valid("json"))),
      )
      // An answer said aloud: its check (kept in the run), the run's checks, the prompt it would send.
      .post("/speaking", zod("json", SpeakingBody), async (c) =>
        c.json(await c.var.s.speaking.check(c.req.valid("json"))),
      )
      .get("/speaking", zod("query", z.object({ lessonKey: LessonKey, runId: Ulid })), (c) => {
        const { lessonKey, runId } = c.req.valid("query");
        return c.json({ checks: c.var.s.speaking.list(lessonKey, runId) });
      })
      .post("/speaking/prompt", zod("json", SpeakingBody), async (c) =>
        c.json(await c.var.s.speaking.prompt(c.req.valid("json"))),
      )
      // An exam's open answer: the ratings proposed (kept in the exam run), the prompt it would send.
      .post("/exam-rating", zod("json", ExamRatingBody), async (c) =>
        c.json(await c.var.s.examRating.propose(c.req.valid("json"))),
      )
      .post("/exam-rating/prompt", zod("json", ExamRatingBody), async (c) =>
        c.json(await c.var.s.examRating.prompt(c.req.valid("json"))),
      )
      // An exam's speaking part held with the assistant: the next lines (kept in the exam run).
      .post("/exam-conversation", zod("json", ConversationBody), async (c) =>
        c.json(await c.var.s.examConversation.turn(c.req.valid("json"))),
      )
      .post("/exam-conversation/prompt", zod("json", ConversationBody), async (c) =>
        c.json(await c.var.s.examConversation.prompt(c.req.valid("json"))),
      )
      .get("/prompts", zod("query", z.object({ language: Lang, target: Lang })), (c) => {
        const { language, target } = c.req.valid("query");
        return c.json(c.var.s.llm.prompts(language, target));
      })
      // The learner's own system prompt of a task ({language}, {target} filled in); null: standing rules.
      .put(
        "/prompts/:task",
        zod("param", z.object({ task: z.enum(PROMPT_TASKS) })),
        zod("json", z.object({ template: z.string().max(20_000).nullable() })),
        (c) => {
          c.var.s.llm.setPrompt(c.req.valid("param").task, c.req.valid("json").template);
          return c.json({ ok: true as const });
        },
      )
      // LM Studio: what it has and runs; start its server, download suggested models into it.
      .get("/lmstudio", async (c) => c.json(await c.var.s.llm.lmStudioStatus()))
      .post("/lmstudio/start", async (c) => c.json(await c.var.s.llm.lmStudioStart()))
      .post(
        "/lmstudio/download",
        zod("json", z.object({ model: z.enum(LMSTUDIO_RECOMMENDED.map((m) => m.key)) })),
        async (c) => c.json(await c.var.s.llm.lmStudioDownload(c.req.valid("json").model)),
      )
      // Scenes: a role-play on the lesson's topic.
      .get("/scene", zod("query", z.object({ lessonKey: LessonKey })), (c) =>
        c.json({
          scenes: c.var.s.scenes.list(c.req.valid("query").lessonKey),
          pending: c.var.s.scenes.pending(c.req.valid("query").lessonKey),
        }),
      )
      .post("/scene/start", zod("json", LessonRequest), async (c) =>
        c.json(await c.var.s.scenes.start(c.req.valid("json"))),
      )
      .post("/scene/turn", zod("json", SceneLine), async (c) =>
        c.json(await c.var.s.scenes.turn(c.req.valid("json"))),
      )
      .post(
        "/scene/prompt",
        zod("json", SceneLine.extend({ text: z.string().max(MESSAGE_MAX) })),
        async (c) => c.json(await c.var.s.scenes.prompt(c.req.valid("json"))),
      )
      // Writing task of a lesson: the task and attempts; a check stores its verdict.
      .get(
        "/writing",
        zod("query", z.object({ series: SeriesKey, lessonKey: LessonKey, edition: EditionId })),
        async (c) => {
          const { series, lessonKey, edition } = c.req.valid("query");
          return c.json(await c.var.s.writing.state(series, lessonKey, edition));
        },
      )
      .post("/writing", zod("json", WritingBody), async (c) =>
        c.json(await c.var.s.writing.check(c.req.valid("json"))),
      )
      .post(
        "/writing/prompt",
        zod("json", WritingBody.extend({ text: z.string().max(WRITING_MAX) })),
        async (c) => c.json(await c.var.s.writing.prompt(c.req.valid("json"))),
      )
      .get("/tutor", zod("query", z.object({ lessonKey: LessonKey })), (c) =>
        c.json({ turns: c.var.s.tutor.history(c.req.valid("query").lessonKey) }),
      )
      .post("/tutor", zod("json", TutorBody), (c) =>
        streamReply(c, () => c.var.s.tutor.send(c.req.valid("json"), c.req.raw.signal)),
      )
      .post(
        "/tutor/context",
        zod("json", TutorBody.extend({ message: z.string().max(MESSAGE_MAX) })),
        async (c) => c.json(await c.var.s.tutor.usage(c.req.valid("json"))),
      )
      .post(
        "/tutor/prompt",
        zod("json", TutorBody.extend({ message: z.string().max(MESSAGE_MAX) })),
        async (c) => c.json(await c.var.s.tutor.prompt(c.req.valid("json"))),
      )
      .post("/tutor/reset", zod("json", z.object({ lessonKey: LessonKey })), (c) => {
        c.var.s.tutor.reset(c.req.valid("json").lessonKey);
        return c.json({ ok: true as const });
      })
      // Chats with the tutor: a lesson's (`lessonKey`), or the Tutor section's (none).
      .get("/tutor/chats", zod("query", ChatsOf), (c) =>
        c.json({ chats: c.var.s.tutor.chats(c.req.valid("query").lessonKey ?? null) }),
      )
      .get("/tutor/chats/:id", zod("param", ChatParam), zod("query", ChatsOf), (c) => {
        const about = c.req.valid("query").lessonKey ?? null;
        const turns = c.var.s.tutor.chat(about, c.req.valid("param").id);
        if (!turns) throw new ServiceError("no_such_chat", 404);
        return c.json({ turns });
      })
      .delete("/tutor/chats/:id", zod("param", ChatParam), zod("query", ChatsOf), (c) => {
        const about = c.req.valid("query").lessonKey ?? null;
        if (!c.var.s.tutor.remove(about, c.req.valid("param").id))
          throw new ServiceError("no_such_chat", 404);
        return c.json({ ok: true as const });
      })
      // The Tutor section: a message (a new chat named in the reply's header), how full the next
      // request is, the request it would send.
      .post("/tutor/section", zod("json", SectionBody), (c) =>
        streamReply(c, async () => {
          const { id, reply } = await c.var.s.tutor.sendSection(
            c.req.valid("json"),
            c.req.raw.signal,
          );
          c.header(CHAT_ID_HEADER, id);
          return reply;
        }),
      )
      .post(
        "/tutor/section/context",
        zod("json", SectionBody.extend({ message: z.string().max(MESSAGE_MAX) })),
        async (c) => c.json(await c.var.s.tutor.sectionUsage(c.req.valid("json"))),
      )
      .post(
        "/tutor/section/prompt",
        zod("json", SectionBody.extend({ message: z.string().max(MESSAGE_MAX) })),
        async (c) => c.json(await c.var.s.tutor.sectionPrompt(c.req.valid("json"))),
      )
      // Setup and provider failures as their responses (the routes return their results only).
      .onError((error, c) => {
        const response = failure(error);
        if (!response) throw error;
        return c.json(response.body, response.status);
      })
  );
}
