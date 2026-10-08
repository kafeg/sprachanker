// Compiles the `sprachanker` binary with the built web app embedded (spec 06), and puts the speech
// engine beside it when it was built (`bun run build:speech`, 08), where the server looks for it.
// Usage: bun apps/cli/scripts/build.ts   (after `bun run build:web`)
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { targetTriple } from "@sprachanker/server";
import { Glob } from "bun";

const cliDir = resolve(import.meta.dir, "..");
const webDist = resolve(cliDir, "../web/dist");
const outDir = join(cliDir, "dist");
const entry = join(outDir, "entry.ts");
const outfile = join(outDir, "sprachanker");

if (!existsSync(join(webDist, "index.html"))) {
  throw new Error(`${webDist}/index.html not found; run \`bun run build:web\` first`);
}

// Each file is imported `with { type: "file" }`, which embeds it in the binary; the map gives the
// server URL path → embedded path. Bun adds a hash to embedded names, so paths are never guessed.
const files = (await Array.fromAsync(new Glob("**/*").scan({ cwd: webDist }))).sort();
const source = [
  'import { main } from "../src/main.ts";',
  ...files.map(
    (file, i) =>
      `import f${i} from ${JSON.stringify(relative(outDir, join(webDist, file)))} with { type: "file" };`,
  ),
  "main(process.argv.slice(2), {",
  "  webFiles: {",
  ...files.map((file, i) => `    ${JSON.stringify(`/${file}`)}: f${i},`),
  "  },",
  "});",
  "",
].join("\n");
await Bun.write(entry, source);

// Bun 1.4 leaves a copy of the runtime (.<hash>-00000000.bun-build) in the working directory on
// every compile: build from the output folder and remove it there.
const workingDir = process.cwd();
process.chdir(outDir);
const result = await Bun.build({ entrypoints: [entry], compile: { outfile }, minify: true });
for (const leftover of new Glob(".*.bun-build").scanSync({ cwd: outDir, dot: true })) {
  rmSync(join(outDir, leftover));
}
process.chdir(workingDir);
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(`built ${relative(process.cwd(), outfile)} with ${files.length} web files`);

// The engine built for this machine only: the binary compiled here runs here.
const engine = `whisper-server-${targetTriple}`;
const built = resolve(cliDir, "../../native/whisper/out", engine);
if (existsSync(built)) {
  copyFileSync(built, join(outDir, engine));
  console.log(`with ${engine}`);
}
