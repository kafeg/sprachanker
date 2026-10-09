# 08 — Speech

**Recording**, **recognition**, **saying instead of typing**, **the AI's check of an answer of
one's own** and **reading aloud** (below). The server's speech module (`services/speech.ts`) talks to the engine (sidecars,
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
  on or off (owner, 2026-10-08). A spoken answer of one's own (no phrase) shows what was heard, and "Check
  with AI" asks for the AI's check of it (07, `check_speaking`; owner, 2026-10-09): the item, the question and the
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

## Reading aloud (TTS)

Course audio is used whenever there is some; reading aloud is for what has none — mostly what the AI
writes (owner, 2026-10-08).
- **Where**: a speaker in the corner of the tutor's replies (in the chat and its history), of a
  scene's partner lines and of a word's AI example; in a card's corner for a word without a
  recording (replayed with R and autoplayed like a recording). A second tap stops; one text is read at
  a time, and a recording or video starting stops it (and it stops them, `ui/playback.tsx`).
- **What is said** (`audio/speak.ts`): a model's Markdown without its markup; a tutor reply in parts,
  each in its language's voice — the learner's language and the one learnt told apart by script
  (Cyrillic, Latin, …: `Intl.Locale`), one voice when both share a script.
- **Engines** (the profile's `speech.readEngine`; owner, 2026-10-08/09): the device's voices (Web
  Speech API, the default), **Qwen3-TTS on this computer** (below), or **Piper on this computer** — Piper voices run by sherpa-onnx's
  `sherpa-onnx-offline-tts` (Apache-2.0; pinned in `native/piper/VERSION`, built static by `bun run
  build:speech`, beside the binary like whisper-server). A part whose language has no Piper voice
  here, or that Piper fails to say, is read by the device's voices. Piper is run once per text (no sidecar; a text
  asked for twice at once is made once: a phrase takes about
  a second with the model's load, e.g. 1.0 s for 3.6 s of German on an M2 Pro); the WAV is kept in
  `<data-root>/cache/tts` by voice, speed and text (the newest 2,000 kept), so a text read again comes
  at once.
- **Piper's voices**: those sherpa-onnx publishes (its `tts-models` release; game-character voices
  left out), listed with their size and sha256 in `services/piper-voices.json`
  (`packages/server/scripts/piper-voices.ts` writes it); downloaded from Settings into
  `<data-root>/models/voices/<id>`, checked, unpacked whole (the model, its tokens, espeak-ng data).
- **Voices**: per language the one the profile picked while it is there, else the best one: on the
  device "Premium", then "Enhanced", of the language's main region (de-DE for German), never a macOS
  novelty voice; with Piper the main region first, then the highest quality. Settings `speech.voices`
  (engine → language → voice), `speech.readRate` (0.5–1.5; Piper's length scale is its inverse),
  `speech.readAtOnce` (none / scenes / all: a line that arrives while the page is open is read at
  once, never what was there on opening).
- **Qwen3-TTS** (owner, 2026-10-09: run by us like whisper): qwentts.cpp's `tts-server` (MIT; pinned by
  commit in `native/qwen/VERSION`, built static with Metal by `bun run build:speech`, beside the
  binary), an OpenAI-compatible server run by the sidecar supervisor (06) with a model — a CustomVoice
  talker (0.6B, or 1.7B used when both are there) and the codec they share, GGUF from Hugging Face at a
  fixed commit, sha256 checked — downloaded from Settings into `<data-root>/models`. Ten languages
  (German, English, Russian, French, Spanish, Italian, Portuguese, Chinese, Japanese, Korean), nine
  named speakers (each speaks every language; a native one by default for Chinese, Japanese and
  Korean, else Ryan), seeded so a text always sounds the same; its readings kept with Piper's. On an
  M2 Pro with the small model: about 3 GB of memory while it runs, a cold start of 5–20 s, then
  twice as fast as it speaks (2.5 s for 5.4 s of German). Warmed when a page that may read opens;
  stopped after 10 idle minutes. Not now: speed (it has no control for it), spoken answers on review
  cards.
