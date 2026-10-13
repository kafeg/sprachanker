// The release an engine's build is kept in on GitHub — made by the Engines workflow, taken by the
// Release workflow: its pinned version and the build script's hash (either changed, it is built
// again). Prints the tag, the engine's out/ folder and its program's file name as JSON.
//   bun native/scripts/tag.ts whisper|piper|qwen
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ENGINES, type EngineName, triple } from "../../packages/server/src/runtime/engines.ts";

const name = process.argv[2] as EngineName;
const engine = ENGINES[name];
if (!engine) throw new Error(`which engine? ${Object.keys(ENGINES).join(", ")}`);
const root = join(import.meta.dir, "..");
const version = readFileSync(join(root, engine.folder, "VERSION"), "utf8")
  .trim()
  .slice(0, 12);
const script = createHash("sha256")
  .update(readFileSync(join(import.meta.dir, "build.ts")))
  .digest("hex")
  .slice(0, 8);
console.log(
  JSON.stringify({
    tag: `engine-${name}-${version}-${script}`,
    out: join(root, engine.folder, "out"),
    file: `${engine.program}-${triple}`,
  }),
);
