---
name: course-check
description: Full QA of one installed course (e.g. DW Nicos Weg A1 ru-de) — re-normalise a clone of the library, audit its files, check every item's own answer, walk every lesson in the browser with screenshots, review the screenshots, sort what is ours from the source's errors. Use when asked to check, verify or QA a course end to end.
---

# Course check

Checks one course as a learner meets it. Never writes to `~/SprachAnker`: everything runs on an APFS
clone. Spec: `docs/spec/10-quality.md` ("Run-throughs"). Takes hours for a whole course: the walk is
long, the screenshot review is the long part.

Inputs: the course key (`<series>/<course>`, e.g. `dw.nicos-weg/a1-ru`), its edition (`ru-de`), the
interface language to walk in (usually the edition's source: `ru`).

## 1. Re-normalise a clone with the current code

The library on disk may be normalised by an older importer. Check what the current code makes of it.

1. Clone: `cp -c -R ~/SprachAnker/library <scratch>/data/library` (APFS: no space, real files untouched).
2. Normalise from the stored raw pages: `bun run cli -- import <provider id> --courses <course> --data <scratch>/data`
   (DW: `dw-nicos-weg`). Pages come from `raw/`; only media or pages not yet stored are fetched.
3. Read the import summary: lessons, `0 unknown exercises`, `0 invalid files`, corrections applied and
   none stale (DW: `courses/dw/src/normalise/corrections.json`).
4. `bun run cli -- verify --data <scratch>/data` — every course ✓.

Any unknown exercise, invalid file or stale correction is a finding before anything else.

## 2. Data checks (scripts, seconds)

- `bun e2e/real/audit.ts <scratch>/data/library <series> <course> <edition>` — entities and markup left
  in text, zero-width or broken characters, empty strings, missing media, unknown exercises, exercises
  without locale text or instruction, the same option twice. One finding per line.
- `bun e2e/real/answers.ts <scratch>/data/library <series> <course> <target language>` — every scored
  item answered with its own answer through the engine's `checkItem` must be correct; a different
  single choice must not. Exit 1 on any problem.

Both must be clean. A problem here is a normaliser or engine bug, not a source error, until the raw page
says otherwise.

## 3. The walk (Playwright, the Mac only)

Uses `e2e/real` (a clone of `SPRACHANKER_LIBRARY` or `~/SprachAnker/library`, empty profiles):

```bash
REAL=<series>/<course> REAL_PER_COURSE=all REAL_UI=<ui lang> REAL_DESKTOP=1 REAL_SHOTS=<scratch>/shots bun run e2e:real
```

- Every lesson walked at phone width (and desktop with `REAL_DESKTOP=1`): words rated, reading pages read,
  every exercise answered with a dummy answer and checked, speaking items recorded with the fake
  microphone, the summary reached; then the profile's store checked.
- An exercise the walk could not answer completely fails its lesson (listed at the end). A speaking item
  held back by design is only listed.
- Labels cut short are listed at the end: look at each.
- `REAL_SHOTS` keeps every checked exercise, reading page and words step as a full-page PNG.
- Expect all lessons passed on both devices. A failure is a finding: open its screenshot first.

The last lesson of a course is often its final test: confirm it was walked and its result shown.

## 4. Screenshot review (subagents)

The screenshots are the only check of what a learner reads. Review every phone screenshot; desktop
ones by sample (they share content; look at wide layouts and tiles).

Limits that matter (else the agents fail with "media removed: request limit"):
- At most ~30 images per agent, at most 2 agents at once.
- One `Read` per image, one after another, never several images in one message.

Split the PNGs into batches of ≤30 (by lesson order), give each agent the brief below with its file
list, collect its notes into `<scratch>/qa/notes-<batch>.txt`.

Brief for each agent (adapt the course and language):

> Each PNG is a full-page capture of one step of the SprachAnker web app, taken by an automated walker
> after it answered every item with a dummy answer (the first option, the letter "a", the first word in
> a bank, a 1-second fake recording) and pressed Check. Wrong answers marked red and the right answer
> shown as "→ X" are expected. The sticky top or bottom bar may appear in the middle of the image (an
> artifact of full-page capture): ignore it. File name: `<device>-<series>_<course>_<unit>-<lesson>-exercise-<index>.png`.
>
> Report real defects, each with file, severity (high/med/low) and a precise description:
> - Layout: overlapping or clipped text, horizontal overflow, misaligned rows, one word alone on a line
>   inside a control, controls too small, uneven spacing.
> - Content: broken or missing images, empty cards or options, an item with no prompt where it needs one,
>   placeholders, visible markup or entities, garbled characters, duplicated text, typos in either
>   language, an instruction that contradicts the exercise (says "choose a photo" with no photos, "two
>   answers" on a single choice), an answer key that does not fit the sentence.
> - Interface language: labels in another language than the interface's.
> - Items left unanswered while others are answered (the walker could not use a control); a player
>   missing where the instruction says listen or watch.
>
> Do not report: correctness marks, the sticky bars, the blurred phrase of speaking exercises, the
> walker's dummy text. Output: "FILE | severity | issue" lines, then "Patterns" (systemic issues with
> counts and 2–3 example files), then "Clean" (how many files had no issue).

Add a "known already" list to the brief from the previous batches, so later agents count known issues
instead of reporting them again.

## 5. Sort the findings

For every content finding, open the stored raw page (`<library>/<series>/raw/<edition>/…`) before
believing it:

- **The source's own error** (the raw page says it): add a correction to the provider's corrections
  file (DW: `courses/dw/src/normalise/corrections.json`, by exercise key, `from` → `to`, a `why`), and
  list it in the course's research note (`docs/research/<source>-…-source-errors.md`).
- **Ours** (the raw page is right, our text or layout is not): a bug in the normaliser, the engine or
  the web app. Fix it in the module that owns it, with a test.
- **A misread** (the reviewer was wrong): drop it. Reviewers misread names, numbers and options often;
  several "source errors" in past runs were misreads.

Report to the owner: the counts (lessons, exercises, items checked, screenshots reviewed), what was
fixed (ours), what was corrected (the source's), and what is left by design.

## Rules

- Never write to `~/SprachAnker`; never commit course content (texts, media, raw pages, screenshots).
- Keep the screenshots and notes in the scratch folder; they are not part of the repository.
- A fix found here gets its own commit, with `bun run check` green, and the walk of its lessons repeated.
