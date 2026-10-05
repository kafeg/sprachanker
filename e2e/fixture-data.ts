// Writes a fresh data root with the fixture course for the e2e run (bun e2e/fixture-data.ts).
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFixtureLibrary } from "@sprachanker/course-fixture";

export const E2E_DATA = join(tmpdir(), "sprachanker-e2e");

if (import.meta.main) {
  rmSync(E2E_DATA, { recursive: true, force: true });
  await writeFixtureLibrary(join(E2E_DATA, "library"));
  console.log(`e2e data root: ${E2E_DATA}`);
}
