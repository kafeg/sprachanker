# 08 — Speech

The server's speech module (`packages/server/src/speech/`) talks to the sidecars through two functions:

```ts
transcribe(audio: Wav16kMono, lang: Lang): Promise<{ text; segments; model; latencyMs }>
synthesise(segments: { lang: Lang; text: string }[], voice?: VoicePrefs): Promise<AudioRef>
```

## Recognition (STT)

- **whisper.cpp `whisper-server`** sidecar with **large-v3-turbo** (quantised); Metal on macOS.
- **Language is explicit**: push-to-talk buttons per language (e.g. 🎤 DE / 🎤 RU); in exercises only the
  target-language button is shown. Auto-detection is never used.
- **Client capture**: MediaRecorder; the browser decodes with WebAudio and uploads 16 kHz mono WAV (no
  ffmpeg on the server) together with the original compressed recording, which is stored in
  `recordings/` for replay; recognition data goes into the answer or turn event (05).
- The reference text is never passed to the recogniser (it biases results).

## Checking speech

- `speech_repeat`: engine word diff (04) between ASR text and reference; show hits and misses.
- ASR "autocorrects" learner errors: show "heard: …" literally; speech results are practice feedback,
  not pronunciation grading.
- `respond` and scenes: the transcript is shown and editable before it goes to the LLM.
- Target (stage 7): median server-side transcription ≤ 1.5 s for 3–5 s utterances on the owner's Mac.

## Synthesis (TTS)

- Course audio is used whenever available; TTS for LLM replies, our own exercises, words without audio.
- Default engine: **Piper** with one German and one Russian voice, downloaded per language; mixed text
  synthesised per language segment. Cached by `(voice, text)` hash in `<app-data>/cache`.
- Later: Qwen3-TTS, cloud speech.
