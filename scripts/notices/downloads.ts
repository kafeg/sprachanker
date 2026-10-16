// What the app downloads when the learner chooses it — never part of a build, so listed with the
// licence and a link each, not with their texts: Whisper's models, Qwen3-TTS's models, each Piper
// voice of the server's catalog (packages/server/src/services/piper-voices.json) by the licence its
// model card states (piper-voices.json here: the card, or the voice's source where it has none).
import VOICES from "../../packages/server/src/services/piper-voices.json" with { type: "json" };
import LICENCES from "./piper-voices.json" with { type: "json" };

const licences = LICENCES as Record<string, { licence: string; source: string }>;
const catalog = () => (VOICES as Array<{ id: string }>).map((v) => v.id).sort();

/** The catalog's voices with no licence named here (notices.test.ts fails on any). */
export const voicesWithoutLicence = () => catalog().filter((id) => !licences[id]);

export function downloads(): string {
  return [
    "Whisper's models (speech recognition): ggml-large-v3-turbo, ggml-small, quantised",
    "  Licence: MIT (OpenAI's Whisper weights, converted by whisper.cpp)",
    "  Source: https://huggingface.co/ggerganov/whisper.cpp (https://github.com/openai/whisper)",
    "",
    "Qwen3-TTS's models (reading aloud): the 0.6B and 1.7B CustomVoice talkers, the 1.7B Base talker,",
    "the 12 Hz tokenizer, as GGUF",
    "  Licence: Apache-2.0 (Alibaba Cloud's Qwen team; GGUF conversion by Serveurperso)",
    "  Source: https://huggingface.co/Serveurperso/Qwen3-TTS-GGUF (https://huggingface.co/Qwen)",
    "",
    "Piper's voices (reading aloud), as sherpa-onnx packs them",
    "  From: https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models",
    "  Each archive also holds eSpeak NG's data (GPL-3.0-or-later,",
    "  https://github.com/espeak-ng/espeak-ng). Each voice's licence, as its model card states it —",
    "  some allow no commercial use or no derivatives:",
    ...catalog().map(
      (id) => `  ${id}: ${licences[id]?.licence ?? "?"} — ${licences[id]?.source ?? "?"}`,
    ),
  ].join("\n");
}
