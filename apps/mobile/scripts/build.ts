// The phone app's page: the web app's build (apps/web), the app's start (src/boot.ts: the server's
// code over the phone's files) run before it, and sql.js's WebAssembly — in dist/, which Tauri builds
// into the app (src-tauri/tauri.conf.json). The Whisper test page (www/) goes along as whisper.html.
//   bun scripts/build.ts
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { $ } from "bun";

const here = join(import.meta.dir, "..");
const dist = join(here, "dist");
const web = join(here, "..", "web");

await $`bun run build`.cwd(web);
rmSync(dist, { recursive: true, force: true });
cpSync(join(web, "dist"), dist, { recursive: true });

// The web app's own files, served to other devices (src/host.ts); its index as built is web.html
// (index.html gets the app's start below).
const webFiles = readdirSync(dist, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => `/${relative(dist, join(entry.parentPath, entry.name))}`);
cpSync(join(dist, "index.html"), join(dist, "web.html"));
// The notification's words while the app is open to other devices: each catalog's.
const i18n = join(web, "src", "i18n");
const HOST_WORDS = { hosting: "desktop.hosting", quit: "desktop.quit" };
const hostWords = Object.fromEntries(
  readdirSync(i18n)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const catalog = JSON.parse(readFileSync(join(i18n, name), "utf8"));
      const word = (key: string) =>
        key.split(".").reduce((at, part) => at?.[part], catalog) as string | undefined;
      const words = Object.entries(HOST_WORDS).map(([name, key]) => [name, word(key)]);
      return [name.slice(0, -".json".length), Object.fromEntries(words)];
    }),
);

// The app's version: the binary's (MAJOR.MINOR.<commits>, apps/cli/scripts/version.ts).
const version = (await $`bun ${join(here, "../cli/scripts/version.ts")}`.text()).trim();
const built = await Bun.build({
  entrypoints: [join(here, "src", "boot.ts")],
  define: {
    SPRACHANKER_VERSION: JSON.stringify(version),
    SPRACHANKER_WEB_FILES: JSON.stringify(webFiles),
    SPRACHANKER_HOST_WORDS: JSON.stringify(hostWords),
  },
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
