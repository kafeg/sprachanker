# 07 — LLM

`packages/llm` is a gateway: providers, prompts, structured outputs, tasks. The rest of the app calls
tasks, never vendor APIs.

## Providers

Configured **per profile**: each learner picks their own provider and model (05). HTTP providers speak
the OpenAI-compatible chat API (`packages/llm/src/client.ts`); command-line providers run an agent
installed on the machine with the user's own subscription (`packages/llm/src/cli.ts`, started by
`packages/server/src/runtime/cli.ts`). Presets live in `packages/llm/src/providers.ts`.

| Provider | Endpoint | API key | Notes |
|---|---|---|---|
| `lmstudio` | `http://localhost:1234/v1`, editable | optional (only when LM Studio requires a token) | local models; integrated through LM Studio's own API (below) |
| `openrouter` | `https://openrouter.ai/api/v1` | required | cloud models |
| `custom` | any OpenAI-compatible URL (LAN, tailnet, cloud) | optional | |
| `claude-code` | `claude -p` on the server's machine | none (Claude subscription, signed in once with `claude`) | models by alias (`sonnet`, `opus`, `haiku`) |
| `codex` | `codex exec` on the server's machine | none (ChatGPT subscription, `codex login`) | read-only sandbox |

Command-line providers run each request in a fresh empty folder with our system prompt and without the
agent's own tools, MCP servers, settings or saved session: only the lesson context goes out. Structured
outputs use `--json-schema` / `--output-schema`; the tutor answers there without its tools. Each request
starts the command (a few seconds).

The profile has one route — provider and model — stored as `llm_routes.task = 'default'`; endpoints
live in the setting `llm.endpoints`, keys in `secrets` (05, 06). The settings page sets them; its
"test" lists the provider's models and measures the round trip.

## LM Studio

Local models run in LM Studio; the app has no LLM runtime of its own and stores no models or engines.
Through LM Studio's native REST API (`/api/v1`, `packages/llm/src/lmstudio.ts`) the settings show
whether it runs (and start it with `lms server start` when it is installed on the same machine), list
its models, set the model in use and ask LM Studio to download suggested models (Gemma 4 by catalog
key; the suggested one is the largest that leaves half of the memory free). Before a task the chosen
model is loaded with an 8k context (LM Studio's own JIT load uses a smaller window). An API token is
sent when LM Studio requires one.

## Tasks

All tasks use the profile's route. Code: `packages/llm/src/tasks/`.

| Task | Input | Output |
|---|---|---|
| `explain_mistake` | exercise item, reference answer, learner answer, lesson grammar pages; the lesson's transcript when the item is about its audio or video | short explanation in the native language (streamed text) |
| `chat_turn` | the lesson tutor: lesson context, known words, the exercise on screen, mistakes, history (the learner's turns marked with the exercise on screen); tools (below) | message (streamed text) |
| `check_writing` | the lesson (title, goals, words, grammar), the writing task from its goals, the learner's text | JSON: verdict, corrected text, corrections[] (wrong, right, explanation), Goethe A1 writing criteria (task, communication, accuracy: 0–2 + comment), feedback |
| `review_session` | the lesson; the run the lesson shows: every exercise with its state (right, with mistakes, done unscored, skipped, not started), first attempts right of scored, its mistakes | JSON: summary, strengths[], topics[] (topic, explanation, examples), next[] |
| `scene_setup` | the lesson (title, goals, words) | JSON: title, situation, partner, goals (1–3), opening line |
| `scene_turn` | scene setup, allowed words, history, the learner's new line | JSON: reply (target language), translation, corrections[] (of the new line only), goalsMet[], done |

"Why is this wrong?" under a wrong closed-exercise item → `explain_mistake`; a finished explanation is
kept as an `llm_verdict` (`task: explain`) on the item in the lesson run, with the attempt it explains,
and shown again from there ("Explain again" asks anew; the newest is shown); "ask about this exercise"
and the lesson tutor → `chat_turn`; "Write it yourself" on the lesson summary (3–5 sentences on the
lesson's goals) → `check_writing`, each attempt an `llm_verdict` in the lesson's `practice` run;
"Session review" on the summary → `review_session`, stored the same way with the lesson run it
reviews (`runId`; older reviews belong to the lesson run started last before them), shown with that run
and offered again when newer answers exist. The review says plainly when exercises were skipped or not
started and praises only what the results show; the scene card on the summary → `scene_setup`, then `scene_turn` per line.

- Fast replies: tasks that answer the learner directly (`explain_mistake`, turns) ask for no reasoning
  phase, in each provider's dialect (LM Studio `reasoning_effort: "none"`, OpenRouter
  `reasoning: { enabled: false }`); a model that always reasons rejects that and is asked again without.
  Inline `<think>…</think>` output is stripped.
- **Structured outputs** (`packages/llm/src/structured.ts`): the JSON Schema of the task's zod schema is
  sent with the request; the reply is validated with zod; an invalid reply gets one repair attempt with
  the problems listed, then the task fails with `invalid_output` and nothing is stored. Requests have
  timeouts.
- Corrections are `{ wrong, right, explanation }`; they carry no rule id (rule ids come with the rules
  registry and enrichment, 9a).
- Prompts: the learner's level and known vocabulary are context; target-language replies stay within
  known material; explanations are in the native language. Course text and learner input are
  delimited data, never instructions.

## Transparency and debugging

- The UI names the assistant wherever it answers (tutor, explanations, practice cards): provider · model.
- Settings → Prompts: each task's system prompt and the context parts it adds, with
  their character limits (`CHAT_TURN_BUDGETS`, `EXPLAIN_MISTAKE_BUDGETS`, `CHECK_WRITING_BUDGETS`,
  `REVIEW_SESSION_BUDGETS`, `SCENE_BUDGETS`).
- The learner can replace a task's system prompt with their own (Settings → Prompts, "Restore" brings
  the standing one back). It is a template in the profile setting `llm.prompts` (task → text);
  `{language}` and `{target}` are filled in with the names of the answer language and the language
  being learnt. The context parts and the delimiting of course text and learner input stay ours.
- A "{}" button (switched on in Settings → Prompts) shows the exact request of a task — endpoint,
  fields, every message with its size — built by the same function as the real call (`<task>Request`,
  `chatBody`); nothing is sent.
- The tutor shows how full the next request is (≈ tokens of the window when known, room for the reply)
  and how many turns still fit; when the earliest no longer fit it suggests a new chat.

## Conversations

- **Lesson tutor** (`chat_turn` from the lesson player): one current chat per lesson, a `chat` run with
  `llm_turn` events; a question and its reply are stored together once the reply has text, so a failed
  call leaves no unanswered turn. "New chat" ends the current one; ended chats stay in the lesson's chat
  history (each with its time, first message and the exercises it was about) until the learner deletes
  one. Context: the lesson (title, goals, words with translations, grammar pages), headwords and titles
  of earlier lessons, the exercise on screen (named, its instruction once, items with answers and the
  learner's checked answers — the tutor gives hints first), the learner's mistakes (this lesson's: those of the run the lesson shows;
  then the latest of earlier lessons; each named by exercise and item, fixed ones marked), the most
  recent turns within a character budget sized for small local models. Each learner turn records the
  exercise on screen; in the history sent to the model a turn starts with `[On screen: Exercise N ·
  Title]` where that changed, so earlier turns about other exercises are not read as about the current
  one. "Review my mistakes" on the lesson summary opens a new chat with that request.
- **Scenes** are `scene` runs with `llm_turn` events. A scene's setup is its run's plan; it is drafted
  from the lesson's goals and words (no authored scenes yet). The app keeps the model honest:
  corrections must quote the learner's new line, met goals only accumulate, all met ends the scene.

## Tools

The tutor may call tools while answering (OpenAI function calling, streamed; up to three tool rounds,
then it must answer): `get_progress`, `get_mistakes` (all lessons or one), `find_word` (where a word is
taught, with its translation), `get_lesson` (goals, words, grammar). Lessons are named "unit.lesson" as
the app shows them. The server runs them on the learner's data; the reply records which tools it used
and the UI shows them. Servers rejecting tools are asked again without. A reminder at the end of the
system message makes small models call tools instead of promising to look later.

## Later

- `check_answer`: LLM verdict for `respond` items (rubric, corrections, explanation, criterion scores).
- Per-task routes (a provider and model per task, falling back to the default route).
- Handoff: a prompt with lesson context, known vocabulary and recent mistakes to copy or open in
  another assistant, with a visible preview first.
- Golden tests: cases per task with expected properties (errors that must be found, claims that must
  not be made, explanation language, JSON validity) to choose default models and check prompt changes.
- After a scene: mistakes by rule, new words (one tap → card), link to "Practise this".
- `exam_score` for Goethe A1 speaking (with speech recognition), tools over cards, cloud usage counters,
  mixed text segmented by language (`[{lang,text}]`) for TTS.
