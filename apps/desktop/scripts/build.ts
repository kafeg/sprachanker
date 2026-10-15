// The desktop app for this Mac: the `sprachanker` binary and the speech engines beside it (apps/cli/dist,
// made by `bun run build:bin`) put into the Tauri shell as its sidecars, the .app built, macOS's
// microphone question added in each language of the web app's catalogs, signed ad hoc (no Developer
// ID: owner, 2026-10-15), then a zip and a dmg of it in dist/.
//   bun scripts/build.ts            (root: bun run build:desktop builds the binary first)
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

const here = join(import.meta.dir, "..");
const cli = join(here, "../cli/dist");
const tauri = join(here, "src-tauri");
const binaries = join(tauri, "binaries");
const out = join(here, "dist");
const env = {
  ...process.env,
  PATH: ["/opt/homebrew/opt/rustup/bin", join(homedir(), ".cargo", "bin"), process.env.PATH].join(
    ":",
  ),
};

const triple = (await $`rustc -vV`.env(env).text()).match(/^host: (.+)$/m)?.[1];
if (!triple) throw new Error("rustc names no host");
if (!existsSync(join(cli, "sprachanker")))
  throw new Error(`no ${cli}/sprachanker: bun run build:bin first`);

// Sidecars as Tauri wants them: each named for the target; the bundle drops the suffix.
rmSync(binaries, { recursive: true, force: true });
mkdirSync(binaries, { recursive: true });
copyFileSync(join(cli, "sprachanker"), join(binaries, `sprachanker-${triple}`));
for (const engine of ["whisper-server", "sherpa-onnx-offline-tts", "tts-server"]) {
  const file = `${engine}-${triple}`;
  if (!existsSync(join(cli, file)))
    throw new Error(`no ${file} beside the binary: bun run build:speech`);
  copyFileSync(join(cli, file), join(binaries, file));
}

// The binary's version (MAJOR.MINOR.<commits>: apps/cli/scripts/version.ts) is the app's too.
const version = (await $`bun ${join(here, "../cli/scripts/version.ts")}`.text()).trim();
// Tauri's command line pinned in package.json (as the Rust crates are in Cargo.toml).
await $`bun x tauri build --bundles app --config ${JSON.stringify({ version })} -- --locked`
  .cwd(here)
  .env(env);
const app = join(tauri, "target/release/bundle/macos/SprachAnker.app");

// The microphone's question in the languages of the catalogs (macOS asks it; zh: Simplified).
const MICROPHONE = "desktop.microphone";
const i18n = join(here, "../web/src/i18n");
for (const name of readdirSync(i18n).filter((n) => n.endsWith(".json"))) {
  const code = name.replace(".json", "");
  const question = (
    JSON.parse(readFileSync(join(i18n, name), "utf8")) as { desktop?: Record<string, string> }
  ).desktop?.[MICROPHONE.slice("desktop.".length)];
  if (!question) continue;
  const lproj = join(app, "Contents/Resources", `${code === "zh" ? "zh-Hans" : code}.lproj`);
  mkdirSync(lproj, { recursive: true });
  writeFileSync(
    join(lproj, "InfoPlist.strings"),
    `"NSMicrophoneUsageDescription" = ${JSON.stringify(question)};\n`,
  );
}
await $`codesign --force --deep --sign - ${app}`;

const arch = triple.startsWith("aarch64") ? "arm64" : "x64";
const base = `SprachAnker-${version}-macos-${arch}`;
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
await $`ditto -c -k --sequesterRsrc --keepParent ${app} ${join(out, `${base}.zip`)}`;
// The dmg: the app and a link to Applications, to drag it there.
const stage = join(out, "dmg");
mkdirSync(stage);
await $`ditto ${app} ${join(stage, "SprachAnker.app")}`;
symlinkSync("/Applications", join(stage, "Applications"));
// hdiutil now and then finds the folder busy (on CI runners): tried again.
for (let attempt = 1; ; attempt++) {
  const made =
    await $`hdiutil create -volname SprachAnker -srcfolder ${stage} -ov -format UDZO ${join(out, `${base}.dmg`)}`
      .quiet()
      .nothrow();
  if (made.exitCode === 0) break;
  if (attempt === 3) throw new Error(`hdiutil: ${made.stderr}`);
  await Bun.sleep(5000);
}
rmSync(stage, { recursive: true, force: true });
console.log(`${out}: ${base}.zip, ${base}.dmg`);
