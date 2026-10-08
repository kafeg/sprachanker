# 08 — Speech

**Recording**, **recognition**, **saying instead of typing** and **the AI's check of an answer of
one's own** (below). The server's speech module (`services/speech.ts`) talks to the engine (sidecars,
06) through `transcribe(audio, lang, model) → { text, ms }`.

## Recording

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
  then a take, played beside it; the item counts once recorded, without a score (owner, 2026-10-08);
  the phrase to repeat hidden until the first try unless shown (a setting); the source's own answer,
  spoken (`answerAudio`, DW's "Lösungsaudio"), playable after it.

## Recognition (STT)

- **whisper.cpp `whisper-server`** (pinned in `native/whisper/VERSION`, built by `bun run build:speech`:
  static, Metal with its shaders embedded; beside the `sprachanker` binary, where the server looks
  for it — also `$SPRACHANKER_WHISPER_SERVER` or the repository's build). Run by the sidecar supervisor
  (06) with the profile's model, warmed when a speaking exercise opens (the large model loads in ~15 s
  on an M2 Pro), stopped after 10 idle minutes (`services/speech.ts`, `runtime/speech.ts`).
- **Models** in `<data-root>/models`: large-v3-turbo q5_0 (574 MB, recommended) and small q5_1 (190
  MB), downloaded from a pinned Hugging Face commit and checked against their sha256, from Settings →
  Speech; each profile turns recognition on or off and picks an installed model (settings
  `speech.recognition`, `speech.model`).
- **Language is explicit**: the item's target language (or the box's, below) goes with each request;
  auto-detection is never used.
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
  on or off (owner, 2026-10-08). A spoken answer of one's own (no phrase) shows what was heard, then the
  AI's check of it (07, `check_speaking`) while an assistant is set up: the item, the question and the
  source's answer — both heard by the recogniser from the course's recordings, once per model while the
  server runs (`speech.heard`) — against what was heard; verdict, feedback, the answer corrected and
  the corrections under the item, kept in the run (05) and in the Notebook; a mistake of the lesson
  when it has errors, never in the score. Recognition off or failing: the recording counts.
- `speech_repeat` (our own exercises): the phrase shown, the same diff, scored; it needs recognition
  (without it the item says so and is left to skip).
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

Course audio is used whenever available. Planned (plan, "Speech: synthesis"): the device's voices by
default, Piper or Qwen3-TTS on the server instead. Not now: spoken answers on review cards.
