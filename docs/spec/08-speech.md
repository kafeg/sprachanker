# 08 — Speech

Built: **recording** (below). Planned (plan, "Speech"): recognition, speaking where text is typed,
synthesis. The answer schema already has a spoken answer (`speech{recording, transcript}`, 05). The
server's speech module will talk to the sidecars through two functions:

```ts
transcribe(audio: Wav16kMono, lang: Lang): Promise<{ text; segments; model; latencyMs }>
synthesise(segments: { lang: Lang; text: string }[], voice?: VoicePrefs): Promise<AudioRef>
```

## Recording (built)

- **Capture** in the browser (`apps/web/src/audio/recorder.ts`): MediaRecorder in the browser's own
  format (Safari MP4/AAC, Chrome WebM/Opus), at most 30 s a take, the loudness shown while it records;
  the microphone chosen per device (Settings → Speech). Only in a secure context (HTTPS or this
  computer, 06): elsewhere the microphone button is disabled and says why (a tooltip; on a phone a line
  under it); so is a browser without MediaRecorder or a denied permission.
- **Kept** in `profiles/<id>/recordings/<ulid>.<ext>` (`POST /api/recordings` with the audio as the
  body, ≤ 5 MB; served with ranges to its own profile only), referenced from the answer that holds it;
  counted and deleted all at once in Settings → Speech; a progress reset deletes those of its runs. With
  "Keep my recordings" off nothing is uploaded: a take plays only until the exercise is left.
- **Saying it oneself** (`speech_selfrate`, the courses' speaking exercises; 09): the original first,
  then a take, played beside it; the item counts once recorded, without a self-rating (owner,
  2026-10-08) and without a score; the phrase to repeat hidden until the first try unless shown (a
  setting). The 16 kHz WAV for recognition is made with recognition (plan).

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
