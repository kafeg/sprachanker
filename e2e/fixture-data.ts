// Writes a fresh data root with the fixture course for the e2e run (bun e2e/fixture-data.ts), and a
// synthetic deck file to import.
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApkg } from "@sprachanker/anki-export/testing";
import { writeFixtureLibrary } from "@sprachanker/course-fixture";
import { E2E_DECK } from "./paths.ts";

export const E2E_DATA = join(tmpdir(), "sprachanker-e2e");

if (import.meta.main) {
  rmSync(E2E_DATA, { recursive: true, force: true });
  await writeFixtureLibrary(join(E2E_DATA, "library"));
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
