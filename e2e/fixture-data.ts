// Writes a fresh data root with the fixture course for the e2e run (bun e2e/fixture-data.ts), a
// synthetic deck file to import, and Piper on paper with a German voice "installed".
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildApkg } from "@sprachanker/anki-export/testing";
import { writeFixtureLibrary } from "@sprachanker/course-fixture";
import { E2E_DATA, E2E_DECK, E2E_PIPER, E2E_VOICE } from "./paths.ts";

/** Piper as the server runs it (`--output-filename=<wav>` among its arguments): 0.2 s of silence,
 *  22.05 kHz 16-bit mono. */
const FAKE_PIPER = String.raw`#!/bin/sh
for a in "$@"; do case "$a" in --output-filename=*) out="${"$"}{a#--output-filename=}";; esac; done
{ printf 'RIFF\230\042\000\000WAVEfmt \020\000\000\000\001\000\001\000\042\126\000\000\104\254\000\000\002\000\020\000data\164\042\000\000'; head -c 8820 /dev/zero; } > "$out"
`;

if (import.meta.main) {
  rmSync(E2E_DATA, { recursive: true, force: true });
  await writeFixtureLibrary(join(E2E_DATA, "library"));
  writeFileSync(E2E_PIPER, FAKE_PIPER, { mode: 0o755 });
  const voice = join(E2E_DATA, "models", "voices", E2E_VOICE);
  mkdirSync(voice, { recursive: true });
  writeFileSync(join(voice, `${E2E_VOICE}.onnx`), "");
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
