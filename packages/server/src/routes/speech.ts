// /api/speech: recognition (08) — the engine and its models (download, remove), the profile's choice
// (on/off and model, in its settings), warming the engine before a recording, and transcribing a
// 16 kHz mono WAV in a language given; reading aloud — Piper's voices and Qwen3-TTS's models
// (download, remove; Qwen warmed ahead) and a text said as a WAV with the profile's engine, voice and
// speed.
import { ALL_LANGS, Lang } from "@sprachanker/schema";
import { Hono } from "hono";
import { z } from "zod";
import { ServiceError } from "../errors.ts";
import { audioBody } from "../media.ts";
import { SAY_MAX } from "../services/read-aloud.ts";
import { recogniserOf } from "../services/speech.ts";
import { zod } from "../validate.ts";
import type { ProfileEnv } from "./env.ts";

/** 30 s of 16 kHz 16-bit mono is under 1 MB. */
const WAV_MAX_BYTES = 2_000_000;
const ModelParam = z.object({ id: z.string().min(1).max(100) });

export function speechRoutes() {
  /** The model the profile uses when recognition is on and ready, else undefined. */
  const modelOf = (s: ProfileEnv["Variables"]["s"]) => recogniserOf(s.speech, s.settings);
  /** The Qwen3-TTS model the profile chose (none: the large one when it is there). */
  const qwenModelOf = (s: ProfileEnv["Variables"]["s"]) => s.settings.get("speech.qwenModel");
  return new Hono<ProfileEnv>()
    .get("/", (c) => {
      const model = modelOf(c.var.s);
      const state = c.var.s.speech.state();
      return c.json({ ...state, recognition: state.engine && !!model, model: model ?? null });
    })
    .post("/models/:id", zod("param", ModelParam), (c) => {
      c.var.s.speech.download(c.req.valid("param").id);
      return c.json(c.var.s.speech.state());
    })
    .delete("/models/:id", zod("param", ModelParam), (c) => {
      c.var.s.speech.remove(c.req.valid("param").id);
      return c.json(c.var.s.speech.state());
    })
    .get("/voices", (c) => c.json(c.var.s.readAloud.state()))
    .post("/voices/:id", zod("param", ModelParam), (c) => {
      c.var.s.readAloud.download(c.req.valid("param").id);
      return c.json(c.var.s.readAloud.state());
    })
    .delete("/voices/:id", zod("param", ModelParam), (c) => {
      c.var.s.readAloud.remove(c.req.valid("param").id);
      return c.json(c.var.s.readAloud.state());
    })
    .get("/qwen", (c) => c.json(c.var.s.qwenTts.state(qwenModelOf(c.var.s))))
    .post("/qwen/models/:id", zod("param", ModelParam), (c) => {
      c.var.s.qwenTts.download(c.req.valid("param").id);
      return c.json(c.var.s.qwenTts.state(qwenModelOf(c.var.s)));
    })
    .delete("/qwen/models/:id", zod("param", ModelParam), (c) => {
      c.var.s.qwenTts.remove(c.req.valid("param").id);
      return c.json(c.var.s.qwenTts.state(qwenModelOf(c.var.s)));
    })
    .post("/qwen/warm", (c) => {
      c.var.s.qwenTts.warm(qwenModelOf(c.var.s));
      return c.json({ ok: true as const });
    })
    .post(
      "/say",
      zod(
        "json",
        z.object({
          text: z.string().trim().min(1).max(SAY_MAX),
          lang: Lang,
          /** The languages a text mixes (a tutor's reply quoting German): read whole, the engine
           *  telling them apart where it can (Qwen3-TTS). */
          langs: z.array(Lang).max(4).optional(),
          /** A voice to hear instead of the profile's (Settings: "Listen"). */
          voice: z.string().min(1).max(100).optional(),
        }),
      ),
      async (c) => {
        const { text, lang, langs, voice } = c.req.valid("json");
        const { settings, readAloud, qwenTts } = c.var.s;
        // The server reads with Qwen3-TTS when the profile chose it, else with Piper.
        const engine = settings.value("speech.readEngine") === "qwen" ? "qwen" : "piper";
        const own = settings.value("speech.voices")?.[engine];
        // Qwen3-TTS reads every language with one voice (its speakers speak them all).
        const chosen = voice ?? own?.[engine === "qwen" ? ALL_LANGS : lang];
        const mixed = new Set([lang, ...(langs ?? [])]).size > 1;
        const wav =
          engine === "qwen"
            ? await qwenTts.say(text, lang, chosen, settings.get("speech.qwenModel"), mixed)
            : await readAloud.say(text, lang, chosen, settings.value("speech.readRate"));
        return c.body(wav, 200, { "content-type": "audio/wav", "cache-control": "no-store" });
      },
    )
    .post("/warm", (c) => {
      const model = modelOf(c.var.s);
      if (model) c.var.s.speech.warm(model);
      return c.json({ ok: true as const });
    })
    .post(
      "/transcribe",
      zod("query", z.object({ lang: Lang })),
      audioBody(WAV_MAX_BYTES),
      async (c) => {
        const model = modelOf(c.var.s);
        if (!model) throw new ServiceError("speech_unavailable", 409);
        const wav = new Uint8Array(await c.req.arrayBuffer());
        if (!wav.length) throw new ServiceError("empty_recording");
        const audio = new Blob([wav], { type: "audio/wav" });
        return c.json(await c.var.s.speech.transcribe(audio, c.req.valid("query").lang, model));
      },
    );
}
