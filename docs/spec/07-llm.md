# 07 — LLM

`packages/llm` is a gateway: providers, task routing, prompts, structured outputs, evaluation. The rest
of the app calls tasks, never vendor APIs.

## Providers

Configured **per profile**: each learner picks their own providers and models (05). Internally
everything is an OpenAI-compatible chat endpoint plus adapters where needed.

| Provider | Notes |
|---|---|
| LM Studio | local, `http://localhost:1234/v1` |
| Ollama | local, `http://localhost:11434/v1` |
| Remote box | any OpenAI-compatible URL on the LAN/tailnet |
| OpenRouter, OpenAI | API key |
| Anthropic | API key; Messages API adapter |
| Built-in llama.cpp | after MVP (06) |

Built today: LM Studio, OpenRouter and "other server" (any OpenAI-compatible URL, optional key); the
profile's default route is `llm_routes.task = 'default'`, endpoints live in the setting `llm.endpoints`,
keys in `secrets` (05, 06).

The provider "test" checks reachability, lists models, measures latency and verifies structured output.

## Tasks

Each task has its own route (provider + model + params) per profile; unset tasks use the profile's
default route.

| Task | Input | Output |
|---|---|---|
| `check_answer` | exercise, reference/rubric, answer, lesson rules | verdict, corrections[], short explanation in native language; with rubric criteria also criterion scores and a corrected text |
| `scene_turn` | scene, allowed vocab/rules, history, learner turn | reply (target language), goal progress, corrections[] |
| `chat_turn` | free chat with the learner's context (progress, recent mistakes; the current exercise when asked from a lesson) | message |
| `translate_mt` | text, languages | translation, marked as machine translation |
| `explain_mistake` | exercise item, reference answer, learner answer, lesson grammar pages | short explanation in the native language (streamed text) |

`respond` → `check_answer`; `scene` → `scene_turn`; "ask about this exercise" → `chat_turn`;
"Why is this wrong?" under a wrong closed-exercise item → `explain_mistake`.

- Fast replies: tasks that answer the learner directly (`explain_mistake`, turns) ask for no reasoning
  phase, in each provider's dialect (LM Studio `reasoning_effort: "none"`, OpenRouter
  `reasoning: { enabled: false }`); a model that always reasons rejects that and is asked again without.
  Inline `<think>…</think>` output is stripped.

- Outputs are JSON validated with zod: invalid → one repair retry → graceful "couldn't check, here is
  the reference answer". Requests have per-task timeouts; a model that is still loading is shown as such.
- Corrections: `{ wrong, right, ruleId?, explanation }`. `ruleId` must come from the list of allowed
  registry ids given in the prompt; unknown ids are dropped. Verdicts are stored as `llm_verdict` events.
- Prompts: the learner's level and known vocabulary are context; target-language replies stay within
  known material; explanations are in the native language; mixed text is segmented by language
  (`[{lang,text}]`) for TTS. Course text and learner input are delimited data, never instructions.
- `translate_mt` results are cached by input hash.

## Conversations

- Scenes and chats are runs with `llm_turn` events: messages, model, corrections, recordings.
- After a scene: mistakes by rule, new words (one tap → card), link to "Practise this".
- **Handoff**: build a prompt with lesson context, known vocabulary and recent mistakes; copy it or open
  `https://claude.ai/new?q=…` / `https://chatgpt.com/?q=…`, with a visible preview first.

## Model choice and evaluation

Defaults are chosen by golden tests, not assumption; candidate models are re-checked at stage 8.

`packages/llm/golden/` holds cases per task: input + expected properties (errors that must be found,
claims that must not be made, explanation language, JSON validity) — A1 German by Russian speakers
(`Ihnen` capitalisation, du/Sie mixing, "Ich bin gut", verb-second, articles), with correct answers as
controls. `sprachanker prompts test --route <provider:model>` prints found-error precision/recall, false
claims, invalid-JSON rate, median latency; the latest table per model goes to
`packages/llm/golden/RESULTS.md` (the only log-style file allowed).

## Later

Chat tools (function calling over progress, mistakes, cards), `session_review`, `exam_score` for Goethe
A1 writing/speaking, cloud usage counters.
