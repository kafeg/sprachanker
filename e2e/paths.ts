// Files the e2e run shares between its setup and the tests.
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The signed-in profile's cookies (written by signed-in.setup.ts). */
export const SIGNED_IN = join(tmpdir(), "sprachanker-e2e-signed-in.json");
