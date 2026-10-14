// The phone app's page: the web app's build (apps/web), the app's start (src/boot.ts: the server's
// code over the phone's files) run before it, and sql.js's WebAssembly — in dist/, which Tauri builds
// into the app (src-tauri/tauri.conf.json). The Whisper test page (www/) goes along as whisper.html.
//   bun scripts/build.ts
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { $ } from "bun";

const here = join(import.meta.dir, "..");
const dist = join(here, "dist");
const web = join(here, "..", "web");

await $`bun run build`.cwd(web);
rmSync(dist, { recursive: true, force: true });
cpSync(join(web, "dist"), dist, { recursive: true });

const built = await Bun.build({
  entrypoints: [join(here, "src", "boot.ts")],
  target: "browser",
  format: "esm",
  minify: process.env.MINIFY !== "0",
  sourcemap: "linked",
  outdir: dist,
  naming: "boot.js",
});
if (!built.success) {
  for (const log of built.logs) console.error(log);
  process.exit(1);
}
const sqlJs = dirname(createRequire(join(here, "package.json")).resolve("sql.js/package.json"));
cpSync(join(sqlJs, "dist", "sql-wasm.wasm"), join(dist, "sql-wasm.wasm"));

// The app's start first: it answers the web app's requests from the moment it runs.
const index = join(dist, "index.html");
const html = readFileSync(index, "utf8");
writeFileSync(
  index,
  html.replace("<head>", '<head>\n    <script type="module" src="/boot.js"></script>'),
);

cpSync(join(here, "www", "index.html"), join(dist, "whisper.html"));
if (existsSync(join(here, "www", "phrases"))) {
  mkdirSync(join(dist, "phrases"), { recursive: true });
  cpSync(join(here, "www", "phrases"), join(dist, "phrases"), { recursive: true });
}
console.log(`the phone app's page → ${dist}`);
