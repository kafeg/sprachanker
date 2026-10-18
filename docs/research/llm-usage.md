# Where the app calls a model (audit, 2026-10-18)

Every model call: what it does, what starts it, whether the course data or the engine could do it,
what it costs, and a recommendation. Asked by the owner after the AI judged a spoken answer where
the course has the exact answer as a recording. What was decided is in `docs/decisions.md`; what is
proposed is item 5 of `docs/plan.md`.

Shared by every call: a structured task is asked again once when its reply is invalid or falls short
of its quality check (1–2 calls); command-line providers retry a failed process once; time limits per
attempt 90 s, longer for the text generator's drafts and judge (180 s), `writing_check` and
`scene_setup` (150 s), questions and going over mistakes (120 s).

| # | Task · service | What it does | Started by | Course data or engine instead? | Calls · wait | Recommendation |
|---|---|---|---|---|---|---|
| 1 | `explain_mistake` · explain.ts | Why one wrong answer is wrong | "Why is this wrong?" (then it streams by itself) | Partly: the right answer and the diff are the engine's; DW items carry no rule ids | 1 streamed, waited for | Keep on request; keep the explanation by item, answer and language across passes |
| 2 | `speaking_check` · speaking.ts | Judges an answer said aloud | **By itself** as an answer is heard | **Yes, mostly**: DW's Lösungsaudio has the answer — heard once into the course | 1 (+1), plus Whisper on 2 recordings the first time | **Replaced** (2026-10-18): the engine checks against the heard answer; the AI only where it cannot judge or on "Why?" |
| 3 | `writing_task` · writing.ts | A message to answer into a task with three points | Course job (page, `sprachanker practice`) | Partly (genre, areas drawn by code) | 1 + the generator's | Keep (once per course) |
| 4 | `writing_check` · writing.ts | Checks a written answer: points, corrections, a model text | Check | Partly (length, the lesson's words could be counted) | 1 (+1), waited for, no thinking | Keep |
| 5 | `understanding_draft` ×3 + `understanding_judge` · text-maker.ts | Practice texts: three drafts, a judge, a rewrite at most twice | Course job | No: generation (genre and areas drawn by code) | 4–8, nobody waits | Keep (once per course) |
| 6 | `understanding_questions` · understanding.ts | Questions on a kept text | Course job | No; the engine checks the answers | 1 (+1) | Keep |
| 7 | `understanding_check` ×2 · understanding.ts | Answers the questions with and without the text; only settled ones kept | Course job | No (decisions: items with one settled answer) | 2 in parallel | Keep |
| 8 | `talk_card` · talk.ts | A monologue card with a model answer | Course job | No | 1 (+1) | Keep |
| 9 | `talk_cues` · talk.ts | A hint for each learner line of a role-play | Course job | Partly (the draft's beats) | 1 | Keep |
| 10 | `writing_check` (spoken) / `talk_check` · talk.ts | Checks a monologue said, or each role-play line | Check | Partly: each line has a good line in the script; a line close to it could be diffed | 1 (+1), waited for, no thinking | Keep |
| 11 | `mistake_items` + `mistake_items_check` · going-over.ts | Per mistake type: an explanation and new items, answered blind | Going over, in the summary | Partly: grouping and checking are the engine's; other lessons' items could stand in | 2–4 per type, side by side, waited for | Keep on request |
| 12 | `scene_setup` / `scene_turn` / `scene_summary` · scene.ts | The old live Dialogue | **Nothing** — no screen reaches it since Speaking | — | — | Remove (old runs keep reading) |
| 13 | `exam_rating` · exam-rating.ts | Proposes an open exam answer's levels per criterion | **By itself** in practice mode; a button after a mock exam | Partly: rubric and samples are given; judging needs the model | 1 (+1), waited for, CLI thinks | Keep; run without thinking |
| 14 | `exam_part` · exam-conversation.ts | A speaking part's script from the Teil's cards | Start of the part, **once per run** | **Yes**: its input is fixed exam data and the hint language | 1 (+1), up to 4000 tokens, waited for | Make once per exam item and language |
| 15 | `word_examples` · examples.ts, deck-examples.ts | 3–5 sentences per deck word, five words a call | Deck job | Partly: the course's sentences using the word (`usesWord`) | ⌈words / 5⌉ (+1 per batch) | Keep; take the course's sentences first |
| 16 | `selection_translate` · finds.ts | Words selected → a card: language, dictionary form, translation | Translate, every selection | **Mostly**: lesson vocabularies, decks and the learner's cards hold most course words | 1 (+1), waited for | Look up first; the model only for what none has |
| 17 | `chat_turn` · tutor.ts | The lesson tutor's reply (tools) | A message | No | 1–4 (tool rounds), waited for | Keep |
| 18 | `section_chat` · tutor.ts | The Tutor section's chat | A message | No | 1, waited for | Keep |

Calls with no button: the spoken check (#2, now only where the engine cannot judge) and an exam's
rating in practice mode (#13). Lesson-start prep and "Another version" take practice already made:
no model.

## The spoken check (#2) as replaced

- Which items: speaking items with no line to say whose source's answer was recorded. DW is the only
  source with such recordings (`answerAudio`); it has them on closed items too, which the engine
  checks already. Nicos Weg A1 (ru): 572 speaking items have one; 212 have a line to say (checked
  as before), 360 are heard.
- Measured on a clone of Nicos Weg A1 (ru), 2026-10-18, Whisper large-v3 turbo on the owner's Mac:
  359 recordings in 252 s (0.7 s each); 342 of the 360 items are checked by the engine, 18 are not:
  6 names spelled letter by letter, 4 name frames whose recording leaves the name out, 4 frames with
  numbers as words heard as digits ("von acht … zwölf" → "von 8 bis 12"), 4 frames with choices
  inside a word ("einmal/zweimal/…"). A1 (uk) afterwards: 358 of 359 taken from A1 (ru), 1 s.
- What stays the model's: items whose recording does not complete their frame, items with no frame
  whose answer differs from the source's (it may be the learner's own), and "Why is this wrong?".
