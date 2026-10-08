# 08 — Speech

Built: **recording**, **recognition** and **saying instead of typing** (below). Planned (plan,
"Speech"): the AI's check of a free spoken answer, synthesis. The answer schema already has a spoken answer (`speech{recording, transcript}`, 05). The
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

- **whisper.cpp `whisper-server`** (pinned in `native/whisper/VERSION`, built by `bun run build:speech`:
  static, Metal with its shaders embedded; beside the `sprachanker` binary, where the server looks
  for it — also `$SPRACHANKER_WHISPER_SERVER` or the repository's build). Started on demand with the
  profile's model on a free 127.0.0.1 port, warmed when a speaking exercise opens (the large model
  loads in ~15 s on an M2 Pro), stopped after 10 idle minutes, started again on the next request if it
  exits (`services/speech.ts`, `runtime/speech.ts`).
- **Models** in `<data-root>/models`: large-v3-turbo q5_0 (574 MB, recommended) and small q5_1 (190
  MB), downloaded from a pinned Hugging Face commit and checked against their sha256, from Settings →
  Speech; each profile turns recognition on or off and picks an installed model (settings
  `speech.recognition`, `speech.model`).
- **Language is explicit**: the item's target language goes with each request; auto-detection is never
  used. Planned for the tutor and scenes: push-to-talk per language (🎤 DE / 🎤 RU).
- **Client**: the take is decoded and resampled to 16 kHz mono WAV in the browser (no ffmpeg on the
  server, `audio/wav.ts`) and sent to `POST /api/speech/transcribe?lang=` while the original is kept in
  `recordings/`; the transcript goes into the answer (05).
- The reference text is never passed to the recogniser (it biases results).
- Measured on the owner's M2 Pro (large-v3-turbo q5_0, Metal): a 3–4 s phrase in 0.7 s warm, 1.2 s
  the first time.

## Checking speech

- A recorded speaking item with its phrase (`speech_selfrate` with `text`): the engine's word diff
  between the transcript and the phrase (`spokenCheck`): every word — "You said it", at least 80% —
  "Almost", fewer — "Try again"; "Heard: …" and the words missed shown under it; kept with the answer
  (transcript, outcome with the diff) and in no score, so a lesson's score is the same with recognition
  on or off (owner, 2026-10-08). A free spoken answer (no phrase) shows what was heard; the AI's check
  of it is planned with speaking where text is typed. Recognition off or failing: the recording counts.
- `speech_repeat` (our own exercises): the same diff, scored.
- ASR "autocorrects" learner errors: show "heard: …" literally; speech results are practice feedback,
  not pronunciation grading (sounds: a phoneme recogniser, set aside — plan, "Later").
- **Saying instead of typing** (`audio/dictate.tsx`): a microphone beside the box of a free answer
  (`respond`, in the answer's language; the take kept as the spoken answer's recording when recordings
  are) and of the tutor and scenes (one per language — the learnt one and the learner's, "DE" / "RU"):
  what was heard goes into the box, joined to what is typed, read over and changed before it is sent.
  Tap to start and stop, or hold while speaking (Settings → Speech). Shown only while recognition is
  on and ready.
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
