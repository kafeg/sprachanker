# Plan

What is left to build. The owner adds features a few at a time: an item comes in when the owner asks
for it and leaves when it is built — its decisions go to `docs/decisions.md`, its structure to the
area's CLAUDE.md. How the parts fit: `docs/architecture.md`.

## Next

### 1. Goethe mock exams on the AI practice's machinery (planned, not begun)
Goethe A1–B1 exist as model papers (one set per level, experimental). The proposal and its options:
`docs/research/goethe-exams-redesign.md`, written before the AI practice was finished; what Reading,
Listening, Writing and Speaking now do changes its cost.
- The owner chooses the option before work starts.
- **Accept**: the chosen option's parts held end to end on Goethe A1–B1 with a real model.

### 2. Releases (proposed, waiting for the owner's choice)
- v0.1 for the owner's family: a GitHub Release built by CI on macOS arm64 — the binary and the speech
  engines in one archive, e2e run on the built files —, installed by one command into
  `~/SprachAnker/bin` (no Gatekeeper prompt: `curl` sets no quarantine), the app saying when a newer
  version is out. Tried on a clean machine: install to the first lesson.
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
