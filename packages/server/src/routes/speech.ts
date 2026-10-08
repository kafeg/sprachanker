// /api/speech: recognition (08) — the engine and its models (download, remove), the profile's choice
// (on/off and model, in its settings), warming the engine before a recording, and transcribing a
// 16 kHz mono WAV in a language given.
import { Lang } from "@sprachanker/schema";
import { Hono } from "hono";
import { z } from "zod";
import { ServiceError } from "../errors.ts";
import { zod } from "../validate.ts";
import type { ProfileEnv } from "./env.ts";

/** 30 s of 16 kHz 16-bit mono is under 1 MB. */
const WAV_MAX_BYTES = 2_000_000;
const ModelParam = z.object({ id: z.string().min(1).max(100) });

export function speechRoutes() {
  /** The model the profile uses when recognition is on and ready, else undefined. */
  const modelOf = (s: ProfileEnv["Variables"]["s"]) =>
    s.settings.get("speech.recognition") === false
      ? undefined
      : s.speech.modelFor(s.settings.get("speech.model"));
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
    .post("/warm", (c) => {
      const model = modelOf(c.var.s);
      if (model) c.var.s.speech.warm(model);
      return c.json({ ok: true as const });
    })
    .post("/transcribe", zod("query", z.object({ lang: Lang })), async (c) => {
      const model = modelOf(c.var.s);
      if (!model) throw new ServiceError("speech_unavailable", 409);
      if (Number(c.req.header("content-length") ?? 0) > WAV_MAX_BYTES)
        throw new ServiceError("recording_too_large", 413);
      const wav = new Uint8Array(await c.req.arrayBuffer());
      if (!wav.length || wav.length > WAV_MAX_BYTES)
        throw new ServiceError("recording_too_large", 413);
      return c.json(await c.var.s.speech.transcribe(wav, c.req.valid("query").lang, model));
    });
}
