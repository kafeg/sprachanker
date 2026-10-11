// Preloaded by `bun test` (bunfig.toml): no test reaches the real app-data folder or data root.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratch = mkdtempSync(join(tmpdir(), "sprachanker-test-"));
process.env.SPRACHANKER_APP_DATA = join(scratch, "app-data");
process.env.SPRACHANKER_DATA = join(scratch, "data");
