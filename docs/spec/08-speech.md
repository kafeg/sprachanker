# 08 — Speech

**Recording**, **recognition**, **saying instead of typing**, **the AI's check of an answer of
one's own** and **reading aloud** (below). The server's speech module (`services/speech.ts`) talks to the engine (sidecars,
06) through `transcribe(audio, lang, model) → { text, ms }`; a profile's choices (recognition on or
off, its model, the engine, voice and speed reading aloud) are applied by `services/profile-speech.ts`.

## Recording

- **Capture** in the browser (`apps/web/src/audio/recorder.ts`): MediaRecorder in the browser's own
  format (Safari MP4/AAC, Chrome WebM/Opus), at most 30 s a take, the loudness shown while it records;
  the microphone chosen per device (Settings → Speech). Only in a secure context (HTTPS or this
  computer, 06): elsewhere the microphone button is disabled and says why (a tooltip; on a phone a line
  under it); so is a browser without MediaRecorder or a denied permission.
- **Kept** in `profiles/<id>/recordings/<ulid>.<ext>` (`POST /api/recordings` with the audio as the
  body, ≤ 5 MB; served with ranges to its own profile only), referenced from the answer or the
  Dialogue line that holds it;
  counted and deleted all at once in Settings → General → Storage; a progress reset deletes those of
  its runs. Always kept (owner, 2026-10-11).
- **Saying it oneself** (`speech_selfrate`, the courses' speaking exercises; 09): the original first,
  then a take, played beside it; the item counts once recorded, without a score (owner, 2026-10-08);
  the phrase to repeat hidden until the first try unless shown ("Show the text") or there is nothing to hear
  first (no recording of the item or its exercise); the source's own answer,
  spoken (`answerAudio`, DW's "Lösungsaudio"), playable after it.

## Recognition (STT)

- **whisper.cpp `whisper-server`** (pinned in `native/whisper/VERSION`, built by `bun run build:speech`:
  static, Metal with its shaders embedded; beside the `sprachanker` binary, where the server looks
  for it — also `$SPRACHANKER_WHISPER_SERVER` or the repository's build). Run by the sidecar supervisor
  (06) with the profile's model, warmed when a speaking exercise opens (the large model loads in ~15 s
  on an M2 Pro), stopped after 10 idle minutes (`services/speech.ts`, `runtime/speech.ts`; where an engine is:
  `runtime/engines.ts`).
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

- A recorded speaking item with a line to say (`speech_selfrate`; engine `linesToSay`: the source's
  answer, `reference`, split into its alternatives at " / "; else the phrase to repeat, `text`, as
  written — words in brackets too —, split so only when one line (a text of several lines is read
  whole); never the question it answers): the engine's word diff between the transcript and the closest line
  (`spokenCheck`): every word — "You said it", at least 80% —
  "Almost", fewer — "Try again"; "Heard: …" and the words missed shown under it; kept with the answer
  (transcript, outcome with the diff) and in no score, so a lesson's score is the same with recognition
  on or off (owner, 2026-10-08). A spoken answer of one's own (no line to say: none given, a source's
  answer that is a frame to complete — an ellipsis, a gap, words in brackets: "Ja, ich … / Nein, ich …" —,
  or a word spelled letter by letter: "E-M-M-A") shows what was heard, and "Check
  with AI" asks for the AI's check of it (07, `check_speaking`; owner, 2026-10-09): the item, the question and the
  source's answer — both heard by the recogniser from the course's recordings, once per model while the
  server runs (`speech.heard`) — against what was heard; verdict, feedback, the answer corrected and
  the corrections under the item, kept in the run (05) and in the Notebook; a mistake of the lesson
  when it has errors, never in the score. Recognition off or failing: the recording counts.
- `speech_repeat` (our own exercises): the phrase shown, the same diff, scored; it needs recognition
  (without it the item says so and is left to skip).
- ASR "autocorrects" learner errors: show "heard: …" literally; speech results are practice feedback,
  not pronunciation grading (sounds: a phoneme recogniser, set aside — plan, "Later").
- **Saying instead of typing** (`audio/dictate.tsx`): a microphone beside the box of an answer that
  is to be said — an exam's speaking part (its conversation, or its `respond` item with `input:
  "speech"`) — in the language learnt only: what was heard goes into the box, joined to what is typed,
  read over and changed before it is sent; a `respond` item keeps the take as its spoken answer. Tap
  to start and stop. Shown only while recognition is on and ready. Never where the task is writing — a
  free answer, the tutor, "Write it yourself" (owner, 2026-10-11).
- **A Dialogue held by voice** (04, "AI practice in courses"; 09): the learner's line is a take — the
  microphone tapped, tapped again — kept in `recordings/` and heard in the language learnt; what was
  heard is shown ("Heard: …") and sent as heard ("Send"), or the line said again ("Say it again"),
  never edited: what the recogniser made of it is what a listener would have understood, so its
  normalisation (punctuation, capitals, numbers as digits) is taken as it is (owner, 2026-10-11).
  Recognition warmed when the step opens. A take nothing was heard in says so and is said again.
  Without a microphone (plain HTTP, no MediaRecorder, access denied) or recognition (off, no model,
  the engine missing), the line is typed instead, the step saying why in a line.
- Target: median server-side transcription ≤ 1.5 s for 3–5 s utterances on the owner's Mac.

## Reading aloud (TTS)

Course audio is used whenever there is some; reading aloud is for what has none — mostly what the AI
writes (owner, 2026-10-08).
- **Where**: a speaker in the corner of a Dialogue's partner lines, an exam conversation's examiner and
  beside each of a word's AI examples — texts in one language, by the voice chosen for it; *planned*
  (next phase): Understanding's text, heard before it is read (04, "AI practice in courses"). Where a
  line is to be listened to, the engine and voice reading it are named, as the model is ("Read by
  Piper · thorsten", "Read by this device · Anna"; 09). A card's
  word is never read on the fly (owner, 2026-10-11): it plays its recording or the one read for its
  deck (04, "A deck's words read aloud"), else nothing plays (R does nothing) and the card's answer has
  the way to its deck in Decks, where the deck's words are read at once. A second tap stops; one text is read at
  a time, and a recording or video starting stops it (and it stops them, `ui/playback.tsx`).
- **A deck's words, read ahead** (04, "A deck's words read aloud"): on request from Review → Decks,
  every word of a deck without a recording is read by Piper or Qwen3-TTS on this computer and kept as
  the engine gives it (WAV; no transcoding) in the deck's folder (05), so a card plays it as a
  recording on any device, the server's engines not asked again. Measured on an A1 deck of 774 words
  (M2 Pro): Piper (thorsten, medium; 22.05 kHz 16-bit mono) about 0.7 s and 30 KB a word — some 23 MB
  for the deck — two words read at once in 0.27 s a word; Qwen3-TTS (0.6B; 24 kHz 16-bit mono) about
  1 s a word after its start, 2–6 s and 100–290 KB a word (silence at the end). Whisper heard 28 of
  32 Piper words and 11 of 11 Qwen3-TTS words as written (the misses short verbs: "bitten" as
  "Bitte", "mögen" not at all).
- **What is said** (`audio/speak.ts`): only a text in one language, that language given explicitly
  — never detected, never a text mixing languages (a tutor's reply quoting German is not read; owner,
  2026-10-11) — by the voice chosen for that language.
- **Engines** (the profile's `speech.readEngine`; owner, 2026-10-08/09): the device's voices (Web
  Speech API, the default), **Qwen3-TTS on this computer** (below), or **Piper on this computer** — Piper voices run by sherpa-onnx's
  `sherpa-onnx-offline-tts` (Apache-2.0; pinned in `native/piper/VERSION`, built static by `bun run
  build:speech`, beside the binary like whisper-server). A part whose language has no Piper voice
  here, or that Piper fails to say, is read by the device's voices. Piper is run once per text (no sidecar; a text
  asked for twice at once is made once: a phrase takes about
  a second with the model's load, e.g. 1.0 s for 3.6 s of German on an M2 Pro); the WAV is kept in
  `<data-root>/cache/tts` by voice, speed and text (the 2,000 used last kept), so a text read again comes
  at once. Parts of downloads (models, voices) and readings a stopped server left go when one starts:
  a download starts anew, it does not go on from a part.
- **Piper's voices**: those sherpa-onnx publishes (its `tts-models` release; game-character voices
  left out), listed with their size and sha256 in `services/piper-voices.json`
  (`packages/server/scripts/piper-voices.ts` writes it); downloaded from Settings into
  `<data-root>/models/voices/<id>`, checked, unpacked whole (the model, its tokens, espeak-ng data).
- **Voices**: per language the one the profile picked while it is there, else the best one: on the
  device "Premium", then "Enhanced", of the language's main region (de-DE for German), never a macOS
  novelty voice; with Piper the main region first, then the highest quality. Settings `speech.voices`
  (engine → language → voice), `speech.readRate` (0.5–1.5; Piper's length scale is its inverse). A
  line is read on request (its button), never at once (owner, 2026-10-11) — but where the exercise is
  held by voice: a Dialogue's new partner line is read as it comes (and again on request), as an
  exam conversation's are; never what was there on opening.
- **Qwen3-TTS** (owner, 2026-10-09: run by us like whisper): qwentts.cpp's `tts-server` (MIT; pinned by
  commit in `native/qwen/VERSION`, built static with Metal by `bun run build:speech`, beside the
  binary), an OpenAI-compatible server run by the sidecar supervisor (06) with a model — a CustomVoice
  talker (0.6B or 1.7B: the profile's `speech.qwenModel`, else the 1.7B when it is there) and the codec they share, GGUF from Hugging Face at a
  fixed commit, sha256 checked — downloaded from Settings into `<data-root>/models`. Ten languages
  (German, English, Russian, French, Spanish, Italian, Portuguese, Chinese, Japanese, Korean), nine
  named speakers (each speaks every language; the profile picks one per language as with the other
  engines — `speech.voices.qwen[<lang>]` —, else Ryan; owner, 2026-10-11), seeded so a text always sounds the same; its readings kept with Piper's. On an
  M2 Pro with the small model: about 3 GB of memory while it runs, a cold start of 5–20 s, then
  twice as fast as it speaks (2.5 s for 5.4 s of German). Warmed when a page that may read opens;
  stopped after 10 idle minutes. Not now: speed (it has no control for it), spoken answers on review
  cards.
