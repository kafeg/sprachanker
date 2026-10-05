# packages/llm

LLM gateway: providers, task routing, prompts, structured outputs, golden tests. Spec: `docs/spec/07-llm.md`.
Depends on `packages/schema` only. Never imports server code; storage of settings, keys and conversations
is the server's job. Web-standard APIs only (fetch, streams), no runtime-specific code.

## Layout

```
src/
  client.ts        # OpenAI-compatible endpoint: models(), streamed chat(); errors as LlmError codes
  providers.ts     # presets: lmstudio, openrouter, custom (endpoint, key need, reasoning-off fields)
  lmstudio.ts      # LM Studio's own API: its models, load with 8k context, downloads; suggested models
  structured.ts    # JSON outputs: schema in the request, zod validation, one repair attempt
  thinking.ts      # strips inline <think>…</think> from streamed text (client.ts also drops control tokens)
  text.ts          # course HTML → plain text for prompts
  tasks/
    describe.ts        # an exercise item as text (task, correct, learner answer); a mistake as two lines
    explain-mistake.ts # explain_mistake: prompt + call
    chat-turn.ts       # chat_turn: the lesson tutor (lesson context, known words, exercise, mistakes, history)
    check-writing.ts   # check_writing: the learner's text on the lesson's topic → structured verdict
    review-session.ts  # review_session: a lesson run's results → strengths, topics, next steps
    scene.ts           # scene_setup + scene_turn: role-play on the lesson's goals; cleanSceneTurn
test/              # fake endpoints (no network); fixture course from @sprachanker/course-fixture
```

Later (target): `tasks/<task>/` with zod output schemas and repair logic for JSON tasks, `router.ts`
(per-task routes, fallback), `handoff.ts`, an Anthropic adapter, `golden/<task>/*.yaml` + `RESULTS.md`.

## Rules

- JSON task outputs are validated with zod; invalid → one repair attempt → fallback → graceful degradation.
- Prompts live next to their task; course text and learner input are delimited data in the prompt.
- Each task exposes `<task>Request(input)` (what is sent), `<task>Rules()` (its system prompt) and its
  context budgets; the real call and the prompt viewer use the same functions.
- Explanations in the learner's native language; target-language text stays in the target language.
- No vendor SDK leaks outside the provider code.
