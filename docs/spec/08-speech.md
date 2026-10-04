# 08 — Speech

`packages/speech` exposes two functions to the server:

```ts
transcribe(audio: Wav16kMono, lang: Lang, opts?): Promise<{ text; segments; model; latencyMs }>
synthesise(segments: { lang: Lang; text: string }[], voice?: VoicePrefs): Promise<AudioRef>
```

## Recognition (STT)

- Default: **whisper.cpp `whisper-server`** sidecar with **large-v3-turbo** (quantised), Metal on macOS,
  CUDA on Windows/Linux NVIDIA, CPU fallback. Kept warm while the app is in use.
- **Language is explicit.** The UI has two push-to-talk buttons — native language and target language
  (e.g. 🎤 RU / 🎤 DE) — so mixed-language speech is never auto-detected. The chosen language is sent with
  the audio.
- Alternatives: smaller whisper models for weak machines. Cloud STT is "later".
- **Client capture**: the browser records with MediaRecorder (iOS produces mp4/aac, Chrome webm/opus),
  decodes with WebAudio and uploads **16 kHz mono WAV**, so the server needs no ffmpeg. The original
  compressed recording is uploaded as well and stored in `recordings/` (05) for replay.
- Recordings are kept (default: forever; local data).

## Checking speech

- `speech_repeat`: compare ASR text with the reference using the engine's normalised word diff (04);
  show hits/misses; outcome `correct | partial | wrong`.
- Known limitation: ASR models "autocorrect" learner errors toward correct language. Mitigations: use the
  reference only for diffing (never as an ASR prompt), report "heard: …" literally, and treat speech
  results as practice feedback, not pronunciation grading.
- `respond` and `scene`: ASR text goes to the LLM task; the transcript is shown and editable before
  sending.
- Acceptance target on the owner's machine (stage 7): median transcription latency ≤ 1.5 s for 3–5 s
  utterances; measured with the owner's own German and Russian phrases.

## Synthesis (TTS)

- Course audio comes from the course (episode, vocabulary audio) whenever available.
- TTS is used for LLM replies, our own exercises, and words without audio.
- Default: **Piper** sidecar with one German voice (e.g. Thorsten) and one Russian voice; voices
  downloaded per language. Mixed-language text is synthesised per language segment (07) and
  concatenated.
- Later: Qwen3-TTS (one voice for both languages), cloud TTS.
- Synthesised audio is cached by `(voice, text)` hash in `<app-data>/cache`.

## Native builds (`native/`)

- `native/whisper`: CMake build of whisper.cpp (`whisper-server`), Metal / CUDA / CPU variants.
- `native/piper`: Piper binary + voice download manifest.
- `native/llama` (after MVP): CMake build of llama.cpp (`llama-server`) for the built-in LLM runtime (07).
- CI produces per-platform binaries that the desktop bundle includes; model files are downloaded at
  runtime (06), never bundled.
