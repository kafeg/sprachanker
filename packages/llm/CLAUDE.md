# packages/llm

LLM gateway: providers, task routing, prompts, structured outputs, golden tests. Spec: `docs/spec/07-llm.md`.
Depends on `packages/schema` only. Never imports server code; storage of conversations is the server's job.

## Layout (target)

```
src/
  providers/       # openai-compatible base; adapters: anthropic; presets: lmstudio, ollama, openrouter, llama-builtin, remote
  tasks/           # one folder per task: prompt template, input/output zod schemas, repair logic
  router.ts        # route + fallback resolution
  tools/           # chat tool definitions (schemas only; execution provided by caller)
  handoff.ts       # build Claude/ChatGPT handoff prompts and URLs
golden/
  <task>/*.yaml    # cases: input + expected properties
  RESULTS.md       # latest results table per model (only log-style file allowed)
```

## Rules

- Every task output is validated with zod; invalid → one repair attempt → fallback → graceful degradation.
- Prompts live next to their task; changing a prompt requires running `prompts test` on the default route
  and updating RESULTS.md.
- Explanations in the learner's native language; target-language text segmented by language for TTS.
- No vendor SDK leaks outside `providers/`.
