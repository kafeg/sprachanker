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
      fields: ["Wort", "Plural", "Übersetzung", "Wortart"],
      notes: [
        { guid: "e2e-1", fields: ["der Apfel", "die Äpfel", "apple", "Nomen"] },
        { guid: "e2e-2", fields: ["die Birne", "die Birnen", "pear", "Nomen"] },
        { guid: "e2e-3", fields: ["der Kaffee", "die Kaffees", "coffee", "Nomen"] },
      ],
    }),
  );
  console.log(`e2e data root: ${E2E_DATA}`);
}
