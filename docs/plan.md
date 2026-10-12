# Plan

What is left to build. The owner adds features a few at a time: an item comes in when the owner asks
for it and leaves when it is built — its decisions go to `docs/decisions.md`, its structure to the
area's CLAUDE.md. How the parts fit: `docs/architecture.md`.

## Next

### 1. Goethe exams: Sprechen and Schreiben as the real exam (owner, 2026-10-12)
The tasks stay the Modellsatz's; Hören and Lesen stay as they are. What is proposed, with screenshots
and mockups: the owner's page "Goethe в SprachAnker"; background: `docs/research/goethe-exams-redesign.md`.
- Sprechen on the Speaking machinery of the lessons: each Teil's own card from the Modellsatz; a
  monologue Teil (A1 T1, A2 T2, B1 T2) said in one take with the Teil's time; a dialogue Teil the
  examiner's fixed lines and the partner's lines prepared from the partner's card, each read by its
  own voice, the learner's lines said in turn; checked once at the end by Goethe's criteria (a
  proposal) with corrections and a way to say it; pronunciation rated by the learner from the takes.
- Schreiben checked as the lessons' Writing is: each point of the task, at most three corrections, a
  model text, then the criteria's points as a proposal.
- Practice mode as a lesson: Check in the step bar until a question is answered and checked, then
  Next (every exam, Leben in Deutschland too). A mock exam keeps Next: nothing is checked before
  hand-in, as in the real exam.
- Goethe A1 out of the experimental sources once its Sprechen works: "experimental" by course, not
  only by source (A2 and B1 stay experimental).
- Open for the owner: whether exams need the practice mode at all; more original sets (Goethe's
  Übungssätze, PDF and MP4) instead of only one Modellsatz per level.
- Built: practice as a lesson (every exam); Schreiben gone over as an examiner does; Sprechen from a
  script (a deck of cards drawn a card a round, a follow-up part about the part before it); A1 out of
  the experimental sources. Tried with a real model on A1, A2 and B1 (Schreiben, every Teil's script,
  A2 Teil 3 said and rated). Remaining: a part held by voice in the browser, the learner's lines
  played into the microphone.
- **Accept**: Goethe A2 Sprechen and Schreiben held end to end by voice with a real model; A1 shown
  without turning on experimental sources.

### 2. Releases
- v0.1 for the owner's family (owner, 2026-10-12: Apple Silicon only). Built: the release workflow
  (`.github/workflows/release.yml`), `apps/cli/install.sh`, the README's Install. Remaining: the first
  tag and its run on GitHub; tried on a clean machine, install to the first lesson; the app saying when
  a newer version is out. Background: the owner's page "Релиз SprachAnker".
- v0.2: Linux builds and a Docker image (engines inside, data in a volume) for a home server.
- v1.0: the desktop app (`apps/desktop`, Tauri), signed and notarised for macOS (an Apple Developer
  ID), then Windows and Linux; automatic updates.
- **Accept** (v0.1): a clean Mac goes from the install command to a lesson with speech checked.

### 3. AI practice: follow-ups
- Speaking's attempts in the Notebook's pass, as writing checks are.
- Going over mistakes across lessons: a Notebook section gathering the mistakes that come back — the
  exercises', Writing's and Speaking's corrections — by type, with new items, offered once enough
  have gathered.
- A live conversation with the model in the Tutor section (`apps/web/src/llm/dialogue.tsx` and the
  `scene` tasks are kept for it).

## Open items in built areas
Taken along when an item above touches the area, or on request.
- Library: a key map for the providers that still number by position (DW and the providers using
  `openKeyMap` keep keys when the source reorders); `normalise <series>` from `raw/` offline;
  `verify` checks for manifest hashes and rule ids; content updated while a run is active ends the
  run. A word the source leaves without a translation in one lesson takes the translation its lexeme
  has elsewhere in the same edition. A course normalised by an older normaliser flagged for
  re-import (the normaliser's revision in the course data, read by `verify` and the course page).
- Server: structured logs.
- Moving one's data: a profile file names its courses by key and edition, not yet by content version.
  An imported deck is named by its id, which another machine's import of the same `.apkg` does not
  share: its cards there keep their display but not their audio. Open for the owner: pruning media no
  course uses.
- Tutor section: no tools yet — what it knows is the summary of the courses; the lesson tutor's tools
  across every course of the chat's language when a summary proves too little.
- Notebook: a lesson's page opened without passes (a link) has no title. A pass's "how long" is still
  from its start to its end (or last work).
- Review: the course map's can-do list; a word anywhere in a lesson opens its sheet.
- Reading aloud: Qwen3-TTS's voice cloning and voice design — on request.
