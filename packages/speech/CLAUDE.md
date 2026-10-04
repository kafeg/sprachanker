# packages/speech

STT/TTS adapters. Spec: `docs/spec/08-speech.md`. Depends on `packages/schema` only.
Process lifecycle of sidecars belongs to the server's sidecar supervisor (see `packages/server/CLAUDE.md`);
this package only talks to the running processes.

## Layout (target)

```
src/
  stt/whisper-server.ts   # HTTP client for whisper.cpp server; explicit language
  tts/piper.ts            # synthesis per language segment, concatenation
  wav.ts                  # WAV 16 kHz mono validation helpers
```

## Rules

- `transcribe` always receives an explicit language; never rely on auto-detection.
- Never pass the expected reference text to the recogniser (it biases results); diffing is engine's job.
- Adapters return model name and latency for logging in events.
