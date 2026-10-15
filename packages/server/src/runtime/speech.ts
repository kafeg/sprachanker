// The engines the sidecar supervisor runs on this machine: whisper-server (recognition) and
// Qwen3-TTS's tts-server (reading aloud), with their models in <data-root>/models — and the voices
// words are read with in models/word-voices —; their pids in models/engines.pid while they run.
import { join } from "node:path";
import type { SpeechHost } from "../services/local-engines.ts";
import { engineAt, engineProcesses, freePort } from "./engines.ts";
import { modelStore, voiceStore } from "./model-files.ts";

export function speechHost(dataRoot: string): SpeechHost {
  const models = join(dataRoot, "models");
  const spawn = engineProcesses(join(models, "engines.pid"));
  const local = ["--host", "127.0.0.1", "--port"];
  return {
    freePort,
    models: modelStore(models),
    wordVoices: voiceStore(join(models, "word-voices")),
    whisper: {
      binary: () => engineAt("whisper"),
      spawn: (binary, { model }, port) =>
        spawn([binary, "-m", model, ...local, String(port), "--no-timestamps"]),
    },
    qwen: {
      binary: () => engineAt("qwen"),
      spawn: (binary, { talker, codec }, port) =>
        spawn([binary, "--model", talker, "--codec", codec, ...local, String(port)]),
    },
  };
}
