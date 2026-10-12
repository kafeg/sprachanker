// The data root of the run-throughs on real courses: a throwaway folder whose
// library is an APFS clone of the real one (`cp -c`: no space used, the real files never touched) and
// whose profiles start empty — the owner's profiles are never read or written. Run before Playwright
// (`bun real/data.ts`); the server the run starts serves this folder.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/** The run's data root (wiped and made anew each run). */
export const REAL_DATA = join(tmpdir(), "sprachanker-real");
export const LIBRARY = join(REAL_DATA, "library");
/** The library cloned: `SPRACHANKER_LIBRARY`, else the default data root's. */
export const SOURCE_LIBRARY =
  process.env.SPRACHANKER_LIBRARY ?? join(homedir(), "SprachAnker", "library");

if (import.meta.main) {
  if (!existsSync(SOURCE_LIBRARY)) {
    console.error(`no library at ${SOURCE_LIBRARY} (set SPRACHANKER_LIBRARY)`);
    process.exit(1);
  }
  rmSync(REAL_DATA, { recursive: true, force: true });
  mkdirSync(LIBRARY, { recursive: true });
  for (const series of readdirSync(SOURCE_LIBRARY, { withFileTypes: true }))
    if (series.isDirectory())
      execFileSync("cp", ["-c", "-R", join(SOURCE_LIBRARY, series.name), LIBRARY]);
  console.log(`run-through data root: ${REAL_DATA} (library cloned from ${SOURCE_LIBRARY})`);
}
