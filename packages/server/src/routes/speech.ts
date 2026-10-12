// /api/speech: recognition — the engine and its models (download, remove), the profile's choice
// (on/off and model, in its settings), warming the engine before a recording, and transcribing a
// 16 kHz mono WAV in a language given (with the lines it was to say, if any: `expect`, one a line —
// only to tell a line said from what Whisper makes of silence); reading aloud — Piper's voices and Qwen3-TTS's models
// (download, remove; Qwen warmed ahead) and a text said as a WAV with the profile's engine, voice and
// speed.
import { Lang } from "@sprachanker/schema";
import { Hono } from "hono";
import { z } from "zod";
import { audioBody } from "../media.ts";
import { SAY_MAX } from "../services/read-aloud.ts";
import { zod } from "../validate.ts";
import type { ProfileEnv } from "./env.ts";

/** 30 s of 16 kHz 16-bit mono is under 1 MB. */
const WAV_MAX_BYTES = 2_000_000;
const ModelParam = z.object({ id: z.string().min(1).max(100) });

export function speechRoutes() {
  return new Hono<ProfileEnv>()
    .get("/", (c) => c.json(c.var.s.speech.state()))
    .post("/models/:id", zod("param", ModelParam), (c) => {
      const { whisper } = c.var.s.speech.engines;
      whisper.download(c.req.valid("param").id);
      return c.json(whisper.state());
    })
    .delete("/models/:id", zod("param", ModelParam), (c) => {
      const { whisper } = c.var.s.speech.engines;
      whisper.remove(c.req.valid("param").id);
      return c.json(whisper.state());
    })
    .get("/voices", (c) => c.json(c.var.s.speech.engines.piper.state()))
    .post("/voices/:id", zod("param", ModelParam), (c) => {
      const { piper } = c.var.s.speech.engines;
      piper.download(c.req.valid("param").id);
      return c.json(piper.state());
    })
    .delete("/voices/:id", zod("param", ModelParam), (c) => {
      const { piper } = c.var.s.speech.engines;
      piper.remove(c.req.valid("param").id);
      return c.json(piper.state());
    })
    .get("/qwen", (c) => c.json(c.var.s.speech.qwen()))
    .post("/qwen/models/:id", zod("param", ModelParam), (c) => {
      c.var.s.speech.engines.qwen.download(c.req.valid("param").id);
      return c.json(c.var.s.speech.qwen());
    })
    .delete("/qwen/models/:id", zod("param", ModelParam), (c) => {
      c.var.s.speech.engines.qwen.remove(c.req.valid("param").id);
      return c.json(c.var.s.speech.qwen());
    })
    .post("/qwen/warm", (c) => {
      c.var.s.speech.warmQwen();
      return c.json({ ok: true as const });
    })
    .post(
      "/say",
      zod(
        "json",
        z.object({
          text: z.string().trim().min(1).max(SAY_MAX),
          lang: Lang,
          /** A voice to hear instead of the profile's (Settings: "Listen"). */
          voice: z.string().min(1).max(100).optional(),
        }),
      ),
      async (c) => {
        // The request gone (a read-ahead let go), its reading stops unless another waits for it.
        const wav = await c.var.s.speech.say(c.req.valid("json"), c.req.raw.signal);
        return c.body(wav, 200, { "content-type": "audio/wav", "cache-control": "no-store" });
      },
    )
    .post("/warm", (c) => {
      c.var.s.speech.warm();
      return c.json({ ok: true as const });
    })
    .post(
      "/transcribe",
      zod("query", z.object({ lang: Lang, expect: z.string().max(4000).optional() })),
      audioBody(WAV_MAX_BYTES),
      async (c) => {
        const wav = new Uint8Array(await c.req.arrayBuffer());
        const { lang, expect } = c.req.valid("query");
        return c.json(await c.var.s.speech.transcribe(wav, lang, expect?.split("\n")));
      },
    );
}
