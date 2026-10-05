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
| Built-in llama.cpp | `llama-server` run by the server (06); models from the catalog below |

Built today: built-in, LM Studio, OpenRouter and "other server" (any OpenAI-compatible URL, optional key); the
profile's default route is `llm_routes.task = 'default'`, endpoints live in the setting `llm.endpoints`,
keys in `secrets` (05, 06).

The provider "test" checks reachability, lists models, measures latency and verifies structured output.

## Built-in model

- Engines (06): llama.cpp (GGUF, every platform) is the default; MLX (mlx-lm, Apple Silicon with
  macOS 14+) can be chosen in the settings. Measured on an M2 Pro (Oct 2026, lesson prompt, reasoning
  off): Gemma 4 E4B 42 vs 28 tok/s, 12B 19.6 vs 19.0 tok/s (llama.cpp vs MLX); llama.cpp also starts
  faster and is ~30 MB against ~350 MB. The route's model is the
  catalog id; each engine serves the model in its own format.
- Catalog (`packages/llm/src/local-models.ts`): each model as GGUF (llama.cpp) and MLX, files on
  Hugging Face pinned by size and sha256, licences allowing local use without sign-in (Gemma 4 today;
  the MLX builds are the `lmstudio-community` ones). The recommended model is the largest that leaves
  half of the machine's memory free.
- Downloads are resumable (`<file>.part`), verified before use, paused and resumed from the settings;
  files live in `<data-root>/models/llm` (GGUF files flat, an MLX build per folder). A file LM Studio
  already has (`~/.lmstudio/models/<repo>/<file>`, same size) is cloned and verified instead of
  downloaded. The first model also installs its engine.
- Servers start with reasoning off (llama.cpp: 8k context; mlx-lm: `enable_thinking: false`).

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

- **Lesson tutor** (`chat_turn` from the lesson player): one chat per lesson, a `chat` run with
  `llm_turn` events; a question and its reply are stored together once the reply has text, so a failed
  call leaves no unanswered turn. Context: the lesson (title, goals, words with translations, grammar
  pages), headwords and titles of earlier lessons, the exercise on screen (with answers — the tutor gives
  hints first), the most recent turns within a character budget sized for small local models.

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
