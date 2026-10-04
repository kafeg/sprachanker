# 07 — LLM

`packages/llm` is a gateway: providers, task routing, prompts, structured outputs, evaluation.
The rest of the app calls tasks, never vendor APIs.

## Providers

All are configured per profile (06). Internally everything is an "OpenAI-compatible chat endpoint" plus
adapters where needed.

| Provider | Notes |
|---|---|
| LM Studio | local, `http://localhost:1234/v1`; on macOS uses MLX or GGUF models |
| Ollama | local, `http://localhost:11434/v1` |
| Built-in llama.cpp (after MVP) | `llama-server` sidecar managed by the Models screen (06) |
| Remote box | any OpenAI-compatible URL (e.g. the 3080 Ti laptop running LM Studio on the LAN) |
| OpenRouter | API key; many models |
| OpenAI | API key |
| Anthropic | API key; adapter for the Messages API |

The provider "test" call checks reachability, lists models, measures latency, and verifies structured
output support on a tiny prompt.

## Tasks and routing

Each task has its own route (provider + model + params) per profile, with a fallback route.

| Task | Input | Output |
|---|---|---|
| `check_answer` | exercise, expected/rubric, learner answer, lesson rules | verdict, corrections[], rule ids, short explanation in native language |
| `scene_turn` | scene definition, allowed vocab/rules, history, learner turn | reply (target language), goal progress, corrections[] |
| `write_check` | task, rubric, text | corrected text, corrections[], rubric scores |
| `explain` | question in native language + lesson context | explanation, examples |
| `chat_turn` | free chat with tools (below) | message (+ tool calls) |
| `exam_score` (later) | exam rubric (e.g. Goethe A1 writing/speaking), answer | criterion scores, justification |
| `session_review` | run summary, mistakes | review text, suggested practice items |
| `translate_mt` | text, languages | translation (marked as machine translation) |
| `author_draft` | installed lesson content (author only) | enrichment draft YAML |

Exercise types map to tasks: `respond`, `translate` → `check_answer`; `write` → `write_check`;
`scene` → `scene_turn`; exam writing/speaking (later) → `exam_score`; the lesson context panel's "ask about this
exercise" → `explain`.

Outputs are JSON validated with zod; invalid output → one repair retry → fallback route → graceful
"couldn't check, here is the reference answer". Corrections are structured:
`{ span, wrong, right, ruleId?, explanation(native) }` so they feed the error log (04). `ruleId` must be an
id from the rules registry (02); the prompt receives the list of allowed ids for the lesson, and unknown
ids are dropped. Verdicts for exercise answers are stored as `llm_verdict` events (05).

Prompt rules: the learner's level and known vocabulary are part of the context; replies in the target
language stay within known material unless the task says otherwise; explanations are in the learner's
native language; text is segmented by language (`[{lang:"de",text:"…"},{lang:"ru",text:"…"}]`) for TTS.

## Conversations

- Scenes, free chat, exam speaking, and "review my mistakes" are runs whose events are `llm_turn`s (05):
  every message, model, latency, corrections, and recordings when spoken.
- After a session: summary with mistakes by rule, new words used or asked about (one tap → cards),
  suggested practice (links to rules and a "Practise this" set).
- **Free chat tools** (function calling, read-mostly): `get_progress`, `get_mistakes(rule?, period?)`,
  `get_lesson(key)`, `add_card(word|sentence)`, `make_practice(rule|selection)`, `search_vocab`.
  Tools act only on the current profile. Write tools require the learner's confirmation in the UI.
- **Handoff**: build a prompt with lesson context, known vocabulary and recent mistakes; open
  `https://claude.ai/new?q=…`, `https://chatgpt.com/?q=…`, or copy to clipboard. Shown in summaries and
  in chat. The prompt preview is visible before sending.

## Defaults and model choice

Defaults are decided by golden tests, not by assumption. Starting candidates (verify the current model
lineups at stage 8):

- macOS 32 GB (owner's machine): Gemma 4 12B (Q4) for checks and scenes; Gemma 4 E4B as light option;
  Gemma 4 26B-A4B as heavy option.
- 16 GB machines: E4B locally or a remote/cloud route.
- Cloud quality route for `write_check` and `author_draft` when the user provides a key.
- Mistral-family models were found unsuitable for Russian explanations (Russian not in their supported
  languages at research time).
- Small (≤4B) local models are acceptable for constrained scene turns; they are not trusted for error
  explanations unless golden tests show otherwise.

## Evaluation (golden tests)

`packages/llm/golden/` holds cases per task: input + expected properties (errors that must be found,
things that must not be claimed, language of explanation, JSON validity). Initial set ≥ 40 cases for
`check_answer` (A1 German by Russian speakers: `Ihnen` capitalisation, du/Sie mixing, "Ich bin gut",
verb-second word order, articles/accusative, correct answers as controls) and ≥ 10 for `scene_turn`.

`sprachanker prompts test --route <provider:model>` prints precision/recall of found errors, false
claims, invalid JSON rate, median latency. Results are recorded in `packages/llm/golden/RESULTS.md` (the
only log-style file allowed; keep the latest table per model).

## Caching and cost

Responses for deterministic tasks (`check_answer` with same inputs, `translate_mt`) are cached by input
hash. Cloud usage per profile is counted and shown in settings.
