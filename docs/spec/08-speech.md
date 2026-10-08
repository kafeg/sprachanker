# 08 — Speech

Planned (plan, "Speech"); nothing of this is built yet. The answer schema already has a spoken answer
(`speech{recording, transcript}`, 05). The server's speech module will talk to the sidecars through two
functions:

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
  not pronunciation grading (sounds: a phoneme recogniser, set aside — plan, "Later").
- `respond` and scenes: the transcript is shown and editable before it goes to the LLM.
- Target: median server-side transcription ≤ 1.5 s for 3–5 s utterances on the owner's Mac.

## Synthesis (TTS)

- Course audio is used whenever available; TTS for LLM replies, AI examples, our own exercises, words
  without audio.
- Default (owner, 2026-10-08): **the device's voices** (Web Speech API, in the browser; Apple's enhanced
  German and Russian voices are close to Siri's) — nothing to install, but each device has its own.
- In the settings instead, on the server: **Piper** (light, the same everywhere, clearly synthetic) or
  **Qwen3-TTS** (Apache-2.0, German and Russian, near commercial quality, needs a strong machine);
  voices downloaded per language; mixed text synthesised per language segment; cached by
  `(voice, text)` hash in `<app-data>/cache`.
- Not now: spoken answers on review cards. Later: cloud speech; pronunciation by sounds (plan, "Later").
