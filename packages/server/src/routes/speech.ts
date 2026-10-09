// /api/speech: recognition (08) — the engine and its models (download, remove), the profile's choice
// (on/off and model, in its settings), warming the engine before a recording, and transcribing a
// 16 kHz mono WAV in a language given; reading aloud with Piper — its voices (download, remove) and a
// text said as a WAV with the profile's voice and speed.
import { Lang } from "@sprachanker/schema";
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
        const { text, lang, voice } = c.req.valid("json");
        const { settings, readAloud } = c.var.s;
        const wav = await readAloud.say(
          text,
          lang,
          voice ?? settings.value("speech.voices")?.piper?.[lang],
          settings.value("speech.readRate"),
        );
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
