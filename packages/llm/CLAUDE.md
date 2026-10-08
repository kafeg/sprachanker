# packages/llm

LLM gateway: providers, prompts, structured outputs, tasks. Spec: `docs/spec/07-llm.md`.
Depends on `packages/schema` only. Never imports server code; storage of settings, keys and conversations
is the server's job. Web-standard APIs only (fetch, streams), no runtime-specific code.

## Layout

```
src/
  cli.ts           # command-line providers (claude -p, codex exec): command lines, prompt, output parsing;
                   # the process itself is started by a CliRunner the server passes in
  client.ts        # OpenAI-compatible endpoint: models() (modelInfo: chat models with their metadata),
                   # streamed chat() with tool rounds, complete();
                   # TimeLimit (to the first byte, then between chunks); errors as LlmError codes
  providers.ts     # presets: lmstudio, openrouter, gemini, groq, custom, claude-code, codex (endpoint,
                   # key, CLI kind)
  lmstudio.ts      # LM Studio's own API: its models, load with 8k context, downloads; suggested models
  openrouter.ts    # OpenRouter's own API: the key's state (free tier, usage, limit, rate limit)
  structured.ts    # JSON outputs: schema in the request, zod validation and the task's check, one repair
  thinking.ts      # strips inline <think>…</think> from streamed text (client.ts also drops control tokens)
  text.ts          # course HTML → plain text for prompts
  tasks/
    lesson.ts          # LessonInfo (what tasks know of a lesson) and its prompt lines: goals, words, grammar
    describe.ts        # an exercise as text: its header (instruction, texts) and items (task, correct,
                       # learner answer); a mistake as two lines naming lesson, exercise and item
    explain-mistake.ts # explain_mistake: prompt + call
    chat-turn.ts       # chat_turn: the lesson tutor (lesson context, known words, exercise, mistakes, history)
    check-writing.ts   # check_writing: the learner's text on the lesson's topic → structured verdict
    check-speaking.ts  # check_speaking: an answer said aloud (what was heard) against the item, its
                       # question and the source's answer as heard → structured verdict
    corrections.ts     # cleanCheck: a check's corrections cleaned (writing, speaking)
    scene.ts           # scene_setup + scene_turn: role-play on the lesson's goals; cleanSceneTurn
    tutor-tools.ts     # the tutor's tool definitions (progress, mistakes, word, lesson) and prompt lines
    word-example.ts    # word_example: a sentence with a card's word in the course's words so far
test/              # fake endpoints (no network); fixture course from @sprachanker/course-fixture
```

Later (07, "Later"): per-task routes, golden tests.

## Rules

- JSON task outputs are validated with zod; invalid → one repair attempt → `invalid_output`, which the
  UI shows as "the model could not answer usefully, try again or a larger model" (nothing is stored).
- Prompts live next to their task; course text and learner input are delimited data in the prompt.
  The delimiting line (and "JSON only") is a fixed suffix after the rules, so the learner's own
  rules never remove it.
- Each task exposes `<task>Request(input)` (what is sent), `<task>Rules()` (its system prompt) and its
  context budgets; the real call and the prompt viewer use the same functions.
- Explanations in the learner's native language; target-language text stays in the target language.
- No vendor SDK leaks outside the provider code.
