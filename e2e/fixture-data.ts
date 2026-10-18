// Writes a fresh data root with the fixture course for the e2e run (bun e2e/fixture-data.ts), a
// synthetic deck file to import, Piper on paper with a German voice "installed", and Qwen3-TTS on
// paper with its small model "installed" (files of the sizes the server checks, holes on disk).
import { mkdirSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildApkg } from "@sprachanker/anki-export/testing";
import { FIXTURE_SERIES, writeFixtureLibrary } from "@sprachanker/course-fixture";
import { addHeard } from "@sprachanker/course-kit";
import { nodeFs } from "@sprachanker/course-kit/node";
import type { CourseKey } from "@sprachanker/schema";
import { E2E_DATA, E2E_DECK, E2E_HEARD, E2E_PIPER, E2E_QWEN, E2E_VOICE } from "./paths.ts";

/** Piper as the server runs it (`--output-filename=<wav>` among its arguments): 0.2 s of silence,
 *  22.05 kHz 16-bit mono. */
const FAKE_PIPER = String.raw`#!/bin/sh
for a in "$@"; do case "$a" in --output-filename=*) out="${"$"}{a#--output-filename=}";; esac; done
{ printf 'RIFF\230\042\000\000WAVEfmt \020\000\000\000\001\000\001\000\042\126\000\000\104\254\000\000\002\000\020\000data\164\042\000\000'; head -c 8820 /dev/zero; } > "$out"
`;

/** tts-server as the server runs it (`--port <n>` among its arguments): its health, and 0.2 s of
 *  silence, 24 kHz 16-bit mono, for any text. */
const FAKE_QWEN = `#!${process.execPath}
const args = process.argv;
const port = Number(args[args.indexOf("--port") + 1]);
const pcm = 4800 * 2;
const wav = new Uint8Array(44 + pcm);
const v = new DataView(wav.buffer);
const tag = (at, s) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
tag(0, "RIFF"); v.setUint32(4, 36 + pcm, true); tag(8, "WAVEfmt "); v.setUint32(16, 16, true);
v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 24000, true);
v.setUint32(28, 48000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
tag(36, "data"); v.setUint32(40, pcm, true);
Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch: (req) =>
    new URL(req.url).pathname === "/health"
      ? Response.json({ status: "ok" })
      : new Response(wav, { headers: { "content-type": "audio/wav" } }),
});
`;
/** Qwen3-TTS's files as the server checks them: by name and size. */
const QWEN_FILES = [
  ["qwen-tokenizer-12hz-Q8_0.gguf", 291_150_624],
  ["qwen-talker-0.6b-customvoice-Q8_0.gguf", 968_588_544],
] as const;

if (import.meta.main) {
  rmSync(E2E_DATA, { recursive: true, force: true });
  await writeFixtureLibrary(nodeFs, join(E2E_DATA, "library"));
  // The fixture's answer recordings as Whisper would hear them (made by the server's hearing, which
  // has no Whisper here): its speaking items are checked against them.
  await addHeard(nodeFs, join(E2E_DATA, "library"), FIXTURE_SERIES, {
    course: `${FIXTURE_SERIES}/demo` as CourseKey,
    lang: "de",
    recordings: {
      "media/audio/guten-abend-danke.mp3": E2E_HEARD,
      "media/audio/hallo-guten-tag.mp3": { text: "Hallo, guten Tag!", model: "e2e", heardAt: 1 },
    },
  });
  writeFileSync(E2E_PIPER, FAKE_PIPER, { mode: 0o755 });
  const voice = join(E2E_DATA, "models", "voices", E2E_VOICE);
  mkdirSync(voice, { recursive: true });
  writeFileSync(join(voice, `${E2E_VOICE}.onnx`), "");
  writeFileSync(E2E_QWEN, FAKE_QWEN, { mode: 0o755 });
  for (const [file, bytes] of QWEN_FILES) {
    const path = join(E2E_DATA, "models", file);
    writeFileSync(path, "");
    truncateSync(path, bytes);
  }
  writeFileSync(
    E2E_DECK,
    buildApkg({
      deck: "E2E Wörter",
      // Fields named by language, each word with an example sentence, as many shared decks have them.
      fields: [
        "part_of_speech",
        "german",
        "sentence_1_german",
        "english",
        "sentence_1_english",
        "russian",
        "sentence_1_russian",
      ],
      notes: [
        {
          guid: "e2e-1",
          fields: [
            "nm",
            "der Apfel",
            "Ich esse einen Apfel.",
            "apple",
            "I eat an apple.",
            "яблоко",
            "Я ем яблоко.",
          ],
        },
        {
          guid: "e2e-2",
          fields: [
            "nf",
            "die Birne",
            "Die Birne ist süß.",
            "pear",
            "The pear is sweet.",
            "груша",
            "Груша сладкая.",
          ],
        },
        {
          guid: "e2e-3",
          fields: [
            "nm",
            "der Tisch",
            "Der Tisch ist neu.",
            "table",
            "The table is new.",
            "стол",
            "Стол новый.",
          ],
        },
      ],
    }),
  );
  console.log(`e2e data root: ${E2E_DATA}`);
}
