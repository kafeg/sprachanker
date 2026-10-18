// Compiles the `sprachanker` binary with the built web app embedded, and puts the speech
// engine beside it when it was built (`bun run build:speech`), where the server looks for it.
// The third-party notices (scripts/notices) go into the web build — the app's About shows them —
// and beside the binary.
// Usage: bun apps/cli/scripts/build.ts   (after `bun run build:web`)
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { PROFILE_DB_WORKER, programSuffix, speechEngines, targetTriple } from "@sprachanker/server";
import { $, Glob } from "bun";
import { appVersion } from "./version.ts";

const cliDir = resolve(import.meta.dir, "..");
const webDist = resolve(cliDir, "../web/dist");
const outDir = join(cliDir, "dist");
const entry = join(outDir, "entry.ts");
const outfile = join(outDir, `sprachanker${programSuffix}`);

if (!existsSync(join(webDist, "index.html"))) {
  throw new Error(`${webDist}/index.html not found; run \`bun run build:web\` first`);
}

// The repository.
const root = resolve(cliDir, "../..");
const NOTICES = "THIRD_PARTY_NOTICES.txt";
await $`bun ${join(root, "scripts/notices/notices.ts")} ${join(webDist, NOTICES)}`;

// Each file is imported `with { type: "file" }`, which embeds it in the binary; the map gives the
// server URL path → embedded path. Bun adds a hash to embedded names, so paths are never guessed.
// Paths with forward slashes: on Windows Glob and relative() give backslashes, and a URL never has them.
const posix = (path: string) => path.split(sep).join("/");
const files = (await Array.fromAsync(new Glob("**/*").scan({ cwd: webDist }))).map(posix).sort();
// The Worker that makes an imported profile's database ready is an entry of its own (Bun bundles a
// Worker only so); in the binary it is named by its path from `root`, the repository.
const source = [
  'import { main } from "../src/main.ts";',
  ...files.map(
    (file, i) =>
      `import f${i} from ${JSON.stringify(posix(relative(outDir, join(webDist, file))))} with { type: "file" };`,
  ),
  "main(process.argv.slice(2), {",
  "  webFiles: {",
  ...files.map((file, i) => `    ${JSON.stringify(`/${file}`)}: f${i},`),
  "  },",
  `  profileDbWorker: ${JSON.stringify(`./${posix(relative(root, PROFILE_DB_WORKER))}`)},`,
  "});",
  "",
].join("\n");
await Bun.write(entry, source);

// Bun 1.4 leaves a copy of the runtime (.<hash>-00000000.bun-build) in the working directory on
// every compile: build from the output folder and remove it there.
const version = appVersion();
const workingDir = process.cwd();
process.chdir(outDir);
const result = await Bun.build({
  entrypoints: [entry, PROFILE_DB_WORKER],
  root,
  compile: { outfile },
  minify: true,
  define: { SPRACHANKER_VERSION: JSON.stringify(version) },
});
for (const leftover of new Glob(".*.bun-build").scanSync({ cwd: outDir, dot: true })) {
  rmSync(join(outDir, leftover));
}
process.chdir(workingDir);
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(`built ${relative(process.cwd(), outfile)} ${version} with ${files.length} web files`);
copyFileSync(join(webDist, NOTICES), join(outDir, NOTICES));

// The speech engines built for this machine only: the binary compiled here runs here.
for (const { folder, program } of Object.values(speechEngines)) {
  const engine = `${program}-${targetTriple}${programSuffix}`;
  const built = resolve(cliDir, "../../native", folder, "out", engine);
  if (existsSync(built)) {
    copyFileSync(built, join(outDir, engine));
    console.log(`with ${engine}`);
  }
}
