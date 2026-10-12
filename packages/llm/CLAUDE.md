# packages/llm

LLM gateway: providers, prompts, structured outputs, tasks. Spec: `docs/spec/07-llm.md`.
Depends on `packages/schema` only. Never imports server code; storage of settings, keys and conversations
is the server's job. Web-standard APIs only (fetch, streams), no runtime-specific code.

## Layout

```
src/
  cli.ts           # command-line providers (claude -p, codex exec): command lines (effort per task),
                   # environment, prompt, output parsing, time limits, one more run of a failed one;
                   # the process itself is started by a CliRunner the server passes in
  client.ts        # OpenAI-compatible endpoint: models(), streamed chat() with tool rounds, complete();
                   # ApiQuirks (what sets a provider apart: reasoning switch, reasoners, token field)
  anthropic.ts     # Anthropic's Messages API (fetch only): the chat in its shape, its stream as text and
                   # tool calls, tool rounds with its blocks, paged models, its errors
  http.ts          # what every HTTP provider shares: endpointCaller (errors mapped to LlmError),
                   # TimeLimit (to the first byte, then between chunks), relaxing (asked again without an
                   # option the provider refused)
  tool-rounds.ts   # toolRounds: a streamed answer with tool rounds, the API's messages in its dialect
  models.ts        # modelInfo: the chat models of a `/models` list with their metadata
  sse.ts           # server-sent events: any stream's data lines (sseData); an OpenAI-compatible reply's
                   # text deltas and tool calls, control tokens dropped
  errors.ts        # LlmError: its codes, the HTTP status, retry-after
  providers.ts     # presets: lmstudio, openrouter, openai, anthropic, gemini, groq, custom, claude-code,
                   # codex (kind, endpoint, key, API quirks, CLI kind); providerClient, providerRequest
                   # (the viewer)
  lmstudio.ts      # LM Studio's own API: its models, load with 8k context, downloads; suggested models
  openrouter.ts    # OpenRouter's own API: the key's state (free tier, usage, limit, rate limit)
  structured.ts    # JSON outputs: schema in the request (Anthropic: its system prompt), quotes escaped
                   # twice made plain, zod validation, the task's fix (made in code), its check, one
                   # repair; its quality: one repair, then the reply kept
  thinking.ts      # strips inline <think>…</think> from streamed text (client.ts also drops control tokens)
  text.ts          # course HTML → plain text for prompts (a table: a row a line, cells joined by " · ");
                   # languages' names; scripts (writtenIn: which of two languages a text is in, where
                   # their scripts differ; mixedWord: a word in two alphabets alike)
  tasks/
    rules.ts           # systemPrompt: the learner's rules or the standing ones, then the fixed suffix and
                       # the reply's languages (languagesLine); NEUTRAL: the line that no
                       # rule assumes the learner's gender, GENDER_FREE: how a learner's language
                       # avoids it (data, in the suffix of the tasks whose rules say NEUTRAL);
                       # learnerWordsProblem: a reply's words to the learner checked (alphabets, gender)
    gender.ts          # genderMarked: words marking the learner's gender (data: ru, uk, pl), a task's quality
                       # (with how to rewrite them); genderFree: "would like to" made impersonal (a fix)
    registry.ts        # TASK_PROMPTS: the tasks whose prompt the learner sees and rewrites, in order —
                       # their rules and budgets (the server's prompt settings read it)
    lesson.ts          # LessonInfo (what tasks know of a lesson, with the knowledge snapshot: level,
                       # place, earlier words with translations, topics met, the course's characters —
                       # speakersOf: a script's speakers by name, roles left out) and its prompt lines
    describe.ts        # an exercise as text: its header (instruction, texts) and items (task, correct,
                       # learner answer); a mistake naming lesson, exercise and item with its wrong
                       # parts only (wrongPartLine)
    exam-conversation.ts # exam_conversation: a speaking part — the examiner's and the partner's lines
    explain-mistake.ts # explain_mistake: prompt + call (where its topic was taught)
    mistake-items.ts   # mistake_items: going over mistakes — an explanation and new items per type of
                       # mistakes (the engine's groups), each item checked for its type;
                       # mistake_items_check: the items answered blind, those not settled left out
    chat-turn.ts       # chat_turn: the lesson tutor (lesson context, known words, exercise, mistakes, history)
    section-chat.ts    # section_chat_turn: the tutor on its own (what the learner met in their courses, history)
    writing-task.ts    # writing_task: a situation and three content points from the lesson (repeatedPoints:
                       # two asking for the same asked again); the length
                       # and what a text needs at a level (data), the exam that sets and rates it (German)
    check-writing.ts   # check_writing: a text on the task → each point rated, at most three corrections,
                       # the level's criteria, a model text
    check-speaking.ts  # check_speaking: an answer said aloud (what was heard) against the item, its
                       # question and the source's answer as heard → structured verdict
    corrections.ts     # cleanCheck: a check's corrections cleaned (no-ops and words the text lacks
                       # dropped), a good text kept as written (writing, speaking)
    rate-exam-answer.ts # rate_exam_answer: an exam's open answer → a level of each of its criteria with
                       # the reason (checked against the levels), feedback
    scene.ts           # the Dialogue: scene_setup (goal card, the partner's hidden facts), scene_turn (a
                       # line judged; repeatedQuestion: a reply ending as the last one did asked again;
                       # cleanSceneTurn: remarks in place of corrections dropped), scene_summary
                       # (key corrections, model lines without the error); goal kinds by level (data)
    tutor-tools.ts     # the tutor's tool definitions (progress, mistakes, word, lesson) and prompt lines
    understanding.ts   # Understanding: understanding_text (a text to hear or read with its questions, its
                       # length and the lesson's grammar by the level; understandingProblem: no course
                       # character, the learner's language where asked), understanding_check (read
                       # again: settledQuestions)
    word-examples.ts   # word_examples: three to five sentences for each of a few words of a deck, in the
                       # words known up to them, at the level when known
test/              # fake endpoints (no network); fixture course from @sprachanker/course-fixture
```

## Rules

- JSON task outputs are validated with zod; invalid → one repair attempt → `invalid_output`, which the
  UI shows as "the model could not answer usefully, try again or a larger model" (nothing is stored).
  A task's `quality` (what makes a valid reply better) gets the one repair too, then the reply is kept.
- Prompts live next to their task; course text and learner input are delimited data in the prompt.
  The delimiting line (and "JSON only"), then the reply's two languages, are a fixed suffix after the
  rules, so the learner's own rules never remove them.
- Each task exposes what is sent — `<task>Request(input)` for a streamed reply, `<task>Task(input)` (a
  StructuredTask, its request inside) for a JSON one —, `<task>Rules()` (its standing system prompt,
  through `systemPrompt`) and its context budgets, and is listed in `TASK_PROMPTS` when the learner
  may rewrite its prompt; the real call and the prompt viewer use the same functions.
- Explanations in the interface language (the request's `language`); target-language text stays in the target language.
- Standing rules assume no level and no language: the level comes with the data (`levelLine`, the
  knowledge snapshot in `LessonInfo`), and what one target language needs (German's ß, Goethe's
  criteria, its commonest words) is a per-language line with the data, never in the rules.
- No vendor SDK leaks outside the provider code.
