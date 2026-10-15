<p align="center">
  <img src="apps/web/public/favicon.svg" alt="SprachAnker icon: a speech bubble with an anchor" width="128" height="128">
</p>

<h1 align="center">SprachAnker</h1>

**A self-hosted language tutor built around real courses.** Download published courses and exam
catalogues into a library on your own machine, then study them in one interface: lessons
with exercises checked as you go, flashcards with spaced repetition, speaking checked by speech
recognition, and practice set by any AI model you connect — a local one or a cloud one.

> **Status:** used daily by its authors for German, in the Mac app or the browser on a Mac with Apple
> Silicon (the only platform for now); phones over Tailscale work and are being tried out. What comes next:
> [`docs/plan.md`](docs/plan.md). The decisions behind it: [`docs/decisions.md`](docs/decisions.md).

## Why

Good language courses already exist — Deutsche Welle's *Nicos Weg* takes you from A1 to B1 with
films, exercises and explanations in 19 languages. But each course lives on its own website, nothing
remembers which words you met, practice ends where the course's exercises end, and most learning apps
replace real courses with generated ones and keep your progress on their servers.

SprachAnker keeps the real course and adds what it lacks:

- **one player for every course**, the same steps and the same look whatever the source;
- **memory**: every word you meet becomes a card, every answer and recording is kept, mistakes come
  back for practice;
- **more practice than the course has**: an AI model writes reading and listening texts, writing and
  speaking tasks on the lesson you just did, at your level, and checks your answers;
- **privacy**: it runs on your computer, without accounts or telemetry.

## What you get

**Courses and lessons**
- Importers download a course from its publisher's site for your personal use; nothing of it is in
  this repository.
- A lesson is a sequence of steps: the episode with its transcript, the lesson's words, grammar and
  culture pages, then the exercises, checked as you answer. The plan beside the lesson marks each step
  right, partly right or with mistakes.
- Help is at hand all the time: the reference (vocabulary, grammar, script), "Why is this wrong?"
  under a wrong answer, and a tutor that knows the lesson you are in.

**AI practice at the end of a lesson** (with a model connected)
- **Reading** and **Listening**: a short real-life text on the lesson's topic — a chat, a letter, a
  notice, a phone call, a voice message —, with 5–10 questions checked by the app, not by the model.
  Listening is read aloud, each person by a voice of their gender.
- **Writing**: an answer to a message (a friend's chat, an e-mail, an ad) with three points to
  cover, rated as a CEFR writing exam rates it; corrections and a model text.
- **Speaking**: a short talk from a card, or a role-play in which you say your part line by line from
  hints; checked at the end.
- **Going over mistakes**: your mistakes of the lesson grouped by type, explained, with new items to
  try.
- Each text is drafted several times, rated by the model and checked again before you see it; it is
  made in the background as the lesson starts.

**Review**
- Cards from every lesson's words (meaning, word, by ear) and from imported Anki decks (`.apkg`),
  studied as in Anki, with FSRS scheduling.
- Any deck — a course's words, an imported one, your Finds — moves to another computer as a file
  (`.sprachanker-deck`) with the audio and examples made for its words.

**Exams**
- Goethe-Zertifikat A1–B1 model papers (A2 and B1 experimental) and the *Leben in Deutschland* test: mock exams under exam
  conditions, practice question by question, open answers rated by the official criteria (by you or
  proposed by the AI).

**Speech**
- Speaking checked by whisper.cpp on your machine; text read aloud by Piper or Qwen3-TTS on your
  machine, or by the browser's own voices.

**Notebook**
- Progress (words known, lessons done), a calendar of study days, every pass of every lesson with its
  answers, recordings and checks, and each exam's results.

**Several people, several devices**
- Profiles keep each learner's progress apart; a profile can be moved to another computer as a file.
- Phones open the same server through your local network or Tailscale (HTTPS, so the microphone
  works) and can install it as an app.

The interface speaks 19 languages, including Arabic and Persian (right to left).

## Courses and exams

| Source | What | Ready |
|---|---|---|
| Deutsche Welle — *Nicos Weg* | German A1–B1, explained in 19 languages | yes |
| BAMF — *Leben in Deutschland* | the citizenship test, all states' questions | yes |
| Goethe-Institut — Goethe-Zertifikat | A1 model paper (A2, B1: experimental) | yes |
| Deutsche Welle — *Deutschtrainer* | German A1–A2 vocabulary | experimental |
| COERLL — *Deutsch im Blick* (CC BY 4.0) | German, first year at university | experimental |
| Lingust, VOA | English for Russian speakers; VOA *Let's Learn English* | experimental |

Experimental sources appear once you turn them on in Settings → Experimental.

## AI models

Any of these, chosen in Settings → AI assistant: LM Studio on the same computer, any
OpenAI-compatible server on your network, OpenRouter, OpenAI, Anthropic, Google Gemini, Groq, or
the Claude Code and Codex command-line agents. Every place the AI works can be turned off one by one;
lessons, review and exams work without any model.

## Install

**Macs with Apple Silicon (M1 and later), macOS 13 or later, only for now.** Linux, a Docker image and Windows come
later ([`docs/plan.md`](docs/plan.md)).

**The app:** download `SprachAnker-<version>-macos-arm64.dmg` from the
[latest release](https://github.com/kafeg/sprachanker/releases/latest), drag SprachAnker into
Applications and open it. It is not notarised: the first time, and again after each update, macOS
refuses — open System Settings → Privacy & Security and click **Open Anyway** next to SprachAnker; it
asks for the microphone again after an update too. The app runs the server: it starts at
login and stays in the menu bar when its window is closed (Quit there stops it), so phones reach it as
below. It replaces the installer's server below if you had it;
its log is `~/Library/Logs/SprachAnker/serve.log`. To update, quit it (menu bar icon → Quit) and
install the newer release over it. To remove it, quit it, delete it from Applications and
`~/Library/LaunchAgents/SprachAnker.plist` (its start at login); your data stays in `~/SprachAnker`.

**Without a window** (a server only, not beside the app), open Terminal and run:

```bash
curl -fsSL https://github.com/kafeg/sprachanker/releases/latest/download/install.sh | bash
```

It downloads the latest release, starts SprachAnker and opens it in your browser at
`http://127.0.0.1:4580`. There you choose your language, make a profile, set up speech (its models
download from there) and, if you like, an AI model; then download a course from Courses → Available.
SprachAnker starts by itself at login. To update, run the same command again.

What goes where:

| Where | What |
|---|---|
| `~/SprachAnker/bin/` | the program: `sprachanker` (the server with the web app inside) and the speech engines beside it — `whisper-server` (recognition), `sherpa-onnx-offline-tts` (Piper voices), `tts-server` (Qwen3-TTS); `serve.log` |
| `~/SprachAnker/` | your data: `library/` (downloaded courses and exams), `profiles/` (each learner's progress and recordings), `decks/` (imported Anki decks, your Finds, the audio and examples made for decks' words), `models/` (speech models and voices), `cache/`, `server.sqlite` with its daily copies |
| `~/Library/Application Support/SprachAnker/secret.key` | the key your AI providers' API keys are stored encrypted with |
| `~/Library/LaunchAgents/app.sprachanker.server.plist` | starts the server at login and again if it stops |
| `~/SprachAnker-backups/` | a copy of your data made before each update (databases, recordings, decks, the key) |

The archive is about 40 MB; with a course, speech models and voices expect 3–5 GB, every course 20 GB
and more. Settings: `SPRACHANKER_HOME` (another folder), `SPRACHANKER_PORT`, `SPRACHANKER_HOST=0.0.0.0`
(phones on the local network, without the microphone), `SPRACHANKER_VERSION=vX.Y.Z` (a given release)
before `bash`, e.g. `curl … | SPRACHANKER_PORT=4600 bash`.

**Phones** open the same server over Tailscale (HTTPS, so the microphone works): Settings → General →
Other devices shows how, with QR codes.

**Remove** it (your data stays in `~/SprachAnker` until you delete it):

```bash
launchctl bootout gui/$(id -u)/app.sprachanker.server; rm ~/Library/LaunchAgents/app.sprachanker.server.plist; rm -rf ~/SprachAnker/bin
```

## Build from source

Requirements: [Bun](https://bun.sh), and `cmake` with a C++ compiler for the speech engines.

```bash
bun install
bun run build:cli
apps/cli/dist/sprachanker serve --data ~/SprachAnker
```

`build:cli` makes `apps/cli/dist/sprachanker` and the speech engines beside it.

## Privacy

Your data — progress, recordings, profiles — stays in the data folder on your machine. The only
things that leave it are the requests to the AI provider you configured, and downloads from the
course publishers' sites. API keys are stored encrypted and never put into a profile file.

## For developers

TypeScript monorepo on Bun: Hono server with SQLite, React web app, pure engine for checking and
scheduling, one importer per content source. Start with [`CLAUDE.md`](CLAUDE.md) (layout, rules,
commands), [`docs/architecture.md`](docs/architecture.md) and
[`docs/decisions.md`](docs/decisions.md) (the owner's decisions and why).

```bash
bun run dev      # server on 127.0.0.1:4580 and Vite
bun run check    # typecheck, lint, dependency rules, tests
bun run e2e      # Playwright against the compiled binary
```

## Content and licences

The repository holds code, importers (lists of public URLs) and our own learning content. It never
contains third-party course material: closed-licence courses are downloaded by each user for personal
use, open-licence ones are shown with their attribution.

## Licence

MIT — see [LICENSE](LICENSE).
