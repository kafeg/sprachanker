# 04 — Engine

`packages/engine` is pure TypeScript: no network, no filesystem, no clock (time is passed in). It runs
on the server and, where useful, in the browser (instant feedback for closed exercises). The server
re-checks answers with the same code when events are appended; the stored outcome is the server's.
Answers of closed exercises are therefore visible to the client — acceptable for self-study (no
anti-cheating).

## Lesson composition

`compose(canonical, locale, enrichment, profile) → ComposedLesson`

1. Take canonical pages and attach locale texts for the profile's edition.
2. Upgrade self-rated speaking by default: every `speech_selfrate` item that has a target-language
   reference text becomes `speech_repeat` (checked by ASR); items without a fixed text ("answer as
   prompted") become `respond`. Enrichment may override this per exercise (`upgrade`, 02).
3. Apply enrichment: rule tags, contrastive notes for the profile's native language, inserted extra
   exercises, scenes, missions. Skip entries whose fingerprint does not match (stale) and report them.
4. Produce the lesson flow:

```
overview (synopsis, goals, video)
→ source pages (exercises in order; new words and info boxes inline)
→ our pages (contrastive note, checked speaking, scene if enriched)
→ summary (score, mistakes by rule, new cards, can-do progress, handoff)
tabs available at any time: grammar · vocabulary · culture · script
```

Lesson completion, scoring and statuses are defined in 05 ("Concurrency and lifecycle").

Every N lessons (a unit), enrichment MAY define a **unit review**: reading text, scene, short writing
task, and a mastery check across the unit's rules; ≥80% marks the unit mastered, otherwise targeted
practice is offered.

## Exercise types and checking

The registry of types, their stored item fields and answer shapes is defined in 02 ("Exercise item
shapes and matching"). Each type has a zod schema (schema), a checker (engine), a renderer (ui-kit) and
tests. A video page is not a type: any page may carry `media.video`, followed by items of normal types.

`check(item, answer, ctx) → Outcome`:

```ts
type Outcome = {
  result: "correct" | "partial" | "wrong" | "unscored";
  score: number;                  // 0..1
  diff?: TokenDiff[];             // for text and speech
  ruleIds: string[];              // from canonical ruleIds + enrichment
  lexemes: string[];              // lexeme keys involved (from newWords / vocab)
  needsLlm?: boolean;             // respond / translate / write: deterministic part done, LLM verdict pending
};
```

- Matching is by ids (options, parts, entries, gaps), never by display position or text.
- `partial` is used only where defined: multi-select with some correct ids, `order` with a correct
  prefix, speech/dictation with ≥ 80% of words matched; otherwise results are binary.
- **Text normalisation** (gap_text, dictation, speech, rubric matching): NFC; unify quotes/apostrophes
  and dashes; collapse whitespace; strip final punctuation; case-insensitive **except** where the target
  language marks case as meaningful (German: nouns and formal `Sie/Ihnen/Ihr` are compared
  case-sensitively). Language rules live in `engine/src/text/<lang>.ts`.
- `respond`: rubric `required` groups are checked deterministically first (each group: any variant
  present after normalisation); then the LLM verdict (07) if an LLM is configured. Without an LLM: rubric
  result + reference answer shown, outcome `partial`/`correct` from the rubric only.
- `speech_selfrate` → upgraded at compose time (see above); if no reference text exists and no LLM is
  configured it stays self-rated and `unscored`.
- `unknown` is never rendered; the page shows "not supported yet" and the importer report links to it.

## Learner model

Derived from events (05); rebuildable.

- **Mistakes** with rule ids and lexemes, from closed exercises (via enrichment rule tags), speech diffs,
  and LLM corrections (structured, 07).
- **Rule mastery**: rolling accuracy per rule with recency weighting; history kept for charts.
- **Lexeme state**: seen, practised, FSRS stability; "in long-term memory" when stability ≥ 21 days.
- **Adaptivity**: two mistakes on the same rule within a lesson insert up to 3 extra items for that rule
  (from enrichment or generated variants of closed items) and schedule the rule into upcoming reviews.
- **Can-do**: course goals ticked when their lessons and linked scenes are completed.

## Spaced repetition

- Algorithm: FSRS via `ts-fsrs`, default parameters; per-profile desired retention (default 0.9);
  parameter optimisation from review history is "later".
- **Cards** are created from: new words of a completed page (automatically; one card per lexeme — meeting
  the word again in another course reuses it), words the learner adds, phrases listed in enrichment
  (`cards.phrases`), sentences from mistakes ("fix this sentence"), imported decks.
  Card faces: target→native, native→target (production), listening (audio→meaning); enabled per deck.
- Card content: word with article colour, plural/forms, translation, example from the lesson where it was
  met (with link), audio (source audio or TTS), image (below).
- **Decks**: virtual `lesson:<key>`, `course:<key>`, `mine`; stored imported and custom decks (05). A card
  can appear in several decks; scheduling is per card face, independent of decks.
- **Review session**: due cards + overdue weak-rule items + small number of new cards; capped by a daily
  limit; 10–15 minutes target.
- **Practice set ("Practise this")**: from a selection in the Notebook (e.g. all `du/Sie` mistakes this
  week) build a run with the original items again, variants, and an optional scene on the topic.

## Anki interoperability (`packages/anki-export`)

- **Export** `.apkg` per deck (lesson, course, mine) including media; scheduling is not exported in v1.
- **Import** `.apkg`: notes become cards in a new deck; fields mapped by a dialog (front/back/audio/image);
  entries matching an existing lexeme key (02) are linked instead of duplicated.

## Images for words

Ordered sources, each result stored with licence and attribution:

1. **ARASAAC** pictograms (CC BY-NC-SA; search API with German, Russian, English keywords; nouns, verbs,
   adjectives, emotions).
2. **OpenMoji** (CC BY-SA 4.0) for concrete concepts.
3. Images from installed course content (personal use).

Later: Noto Emoji, Twemoji, Mulberry Symbols, photos via Wikidata/Wikimedia Commons and Openverse.

"Pick image" offers candidates from these sources; a batch suggestion runs once after a course install;
the learner can replace or remove any image. Images are fetched at runtime into the profile's media and
never bundled with the app.

## Missions and scenes (definitions)

- **Scene**: setting, roles, learner goals (checklist), allowed vocabulary/rules (from completed lessons
  + listed extras), max turns, register (`du`/`Sie`), success criteria. Defined in enrichment YAML.
- **Mission**: a real-life task (e.g. "say hello to a neighbour in the morning"), linked to a lesson,
  marked done by the learner, optionally with a short report (text or recording) checked by the LLM.
