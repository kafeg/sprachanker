---
name: ai-practice-check
description: "Check the AI practice (Reading, Listening, Writing, Speaking, going over mistakes) with a real model: texts and tasks made in bulk and read, lessons A1–B1 walked as a learner who makes mistakes, checks and marks judged. Use after changing prompts, the text generator or an AI step, or when asked to test the AI practice 'for real'. Not for e2e (fake model) or a whole course's QA (course-check)."
---
# ai-practice-check
Judges the AI practice as a learner meets it, with the model chosen in Settings, and turns findings into prompt or code fixes.

## Rules
- ⚠️ Never use `~/SprachAnker` data: both scripts clone the library into their own folder and run their own server.
- Use a real model (default: Claude Code · sonnet). The fake model in `e2e/fake-llm.ts` proves the flow, not the quality.
- Cover the course's span: lessons from the start, the middle and the end of A1, two of A2, two of B1 (`b1-de` in the `de-de` edition).
- Judge from the learner's side: coherent and natural, at the lesson's level, keys right, a check that finds the mistakes and corrects nothing right.
- Tune prompts from what the runs show, never from a guess. Run again after each fix.

## Procedure
1. Texts and tasks in bulk (fast to read, 20–40 min):
   ```bash
   TEXTS_STEPS=reading,listening,writing,speaking,speaking TEXTS_OUT=<scratch>/texts bun run practice:texts
   ```
   Read `<scratch>/texts/report.md`. Look for: incoherent lines, the same names or genres again, a level too high at the course's start, a key that is wrong, a hint that gives the words away, a model answer padded to length.
2. Walk lessons as a learner (`e2e/ai/walk.ts`). Make the work (exercises and texts answered, one question wrong on purpose):
   ```bash
   WALK_OUT=<scratch>/walk bun run practice:walk make
   ```
3. Write `<scratch>/walk/answers.json` as a learner of that level with typical mistakes (ß as ss, word order after `weil`/question words, cases after prepositions, endings). Shape: `{ "<lesson key>": { "writing": "<text>", "talk": [[{ "n": <line>, "text": "<said>" }]], "mistakes": true } }`. A monologue is one line, `n: 0`; a role-play has one entry for each learner line.
4. Check them, go over the mistakes, read the marks:
   ```bash
   WALK_OUT=<scratch>/walk bun run practice:walk answer
   WALK_OUT=<scratch>/walk bun run practice:walk marks
   ```
   The answer phase also makes the other kind of Speaking task. Add its lines to `answers.json` and run `answer` again to check it.
5. Read `<scratch>/walk/report.md`. Each check must find the mistakes put in and leave correct text alone. Each mark must match the answers (one question wrong → partly right with its count).
6. Fix prompts (`packages/llm/src/tasks/*`) or code. Run `bun run check` and repeat the affected step.
7. Report to the owner: what was walked, what was good, what was fixed, what is left (with examples quoted).

## Gotchas
- A text takes 1–2 min (drafts, judge, questions, checks): run lessons in parallel; never set a fetch timeout.
- A change to a practice task changes its price → measure one lesson's tokens before a whole course: a `claude` wrapper first on `PATH` keeps each run's prompt and its result's `usage` (`docs/research/llm-usage.md`).
- `no draft passed` on a course's first lesson → few words known → expected now and then; Writing then sets its task without a message.
- A port in use → an earlier run's server is still up → `pkill -f "serve --port 4598"` (walk) or 4597 (texts).

## Boundaries
- Flows with the fake model: `bun run e2e` (`new-feature`).
- A whole course's exercises and screens: `course-check`.

<!-- style: ste80 -->
