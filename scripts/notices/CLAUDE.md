# scripts/notices

`THIRD_PARTY_NOTICES.txt`: every third-party component the builds give out — its version, licence,
copyright, the link to its exact source, the builds it is in —, then each licence text once. Why it
is shipped and where: `docs/decisions.md` (third-party notices). It lives here, not in one app: it
spans every build (the program, the Mac app, the Android app) and reads every lockfile.

## Layout

```
notices.ts       # the generator: the inventory, the JavaScript packages of the shipped workspaces
                 # (bun.lock: apps/web, apps/cli, apps/mobile — `dependencies` only; texts from
                 # node_modules), the Rust crates the desktop and phone apps link (`cargo metadata`,
                 # normal dependencies, no procedural macros; texts from cargo's registry), rendered
                 # sorted, texts deduplicated. `bun scripts/notices/notices.ts <file>...`
inventory.ts     # hand-kept: the speech engines and what each links (whisper.cpp, sherpa-onnx with
                 # eSpeak NG and its dependencies, qwentts.cpp), Bun, the Android libraries Gradle
                 # resolves, the GPL/LGPL source statement and written offer
downloads.ts     # what the app downloads when chosen (models, Piper voices with their licences:
                 # piper-voices.json, each its model card's): listed with links, not shipped
piper-voices.json # each Piper voice's licence and its source (model card), by the catalog's id
check.ts         # what the inventory must name: each engine at its native/<engine>/VERSION, Bun at
                 # package.json's, ONNX Runtime at the phone build's, the Gradle build's libraries,
                 # every voice's licence
notices.test.ts  # check.ts on the repository (bun run check), the generator's parts
texts/           # licence texts no package folder holds: the engines' own (copied from their sources
                 # at the pinned versions), Bun's statement, spdx-<id>.txt (spdx/license-list-data)
```

## Who runs it

- `apps/cli/scripts/build.ts` (build:bin): into the web build (served at `/THIRD_PARTY_NOTICES.txt`,
  embedded) and beside the binary; the release archive takes it from there, the desktop build
  copies it into `SprachAnker.app/Contents/Resources`.
- `apps/mobile/scripts/build.ts`: into the phone app's `dist/` and the Android project's assets.
- Needs `bun install` and Rust (`cargo`, `rustc`): crates are read through `cargo metadata`.

## Rules

- A new engine version (`native/<engine>/VERSION`), a new sherpa-onnx dependency, a new Bun or a
  Gradle library changed: update `inventory.ts` (versions, sources, texts copied from the new
  sources) — `notices.test.ts` fails until the pinned versions match.
- A Piper voice added to the server's catalog gets its licence and source (its model card) in
  `piper-voices.json` here.
- A component under the GPL or LGPL: its exact source linked and named in `SOURCE_OFFER`.
- The output is deterministic: no dates, everything sorted.
