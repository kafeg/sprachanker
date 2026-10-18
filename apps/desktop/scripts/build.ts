// The desktop app for this computer: the `sprachanker` binary and the speech engines beside it
// (apps/cli/dist, made by `bun run build:bin`) put into the Tauri shell as its sidecars, the third-party
// notices among its resources (on macOS also the microphone's question in each language of the web
// app's catalogs), then bundled for this system into dist/:
// - macOS: the .app, signed ad hoc (no Developer ID: owner, 2026-10-15), as a zip and a dmg, and as
//   the .app.tar.gz the app updates itself from;
// - Windows: an installer (NSIS, for the user alone: no administrator);
// - Linux: a .deb (WebKitGTK and GTK the system's: an AppImage would carry them, and their licences
//   and sources with them).
// The update files are signed after it by sign.ts, so the updater's key is in no build's environment.
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
import { delimiter, join } from "node:path";
import { $ } from "bun";

const here = join(import.meta.dir, "..");
const cli = join(here, "../cli/dist");
const tauri = join(here, "src-tauri");
const binaries = join(tauri, "binaries");
const out = join(here, "dist");
const env = {
  ...process.env,
  PATH: ["/opt/homebrew/opt/rustup/bin", join(homedir(), ".cargo", "bin"), process.env.PATH].join(
    delimiter,
  ),
};
const system =
  process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux";
const exe = system === "windows" ? ".exe" : "";

const triple = (await $`rustc -vV`.env(env).text()).match(/^host: (.+)$/m)?.[1]?.trim();
if (!triple) throw new Error("rustc names no host");
for (const file of [`sprachanker${exe}`, "THIRD_PARTY_NOTICES.txt"])
  if (!existsSync(join(cli, file))) throw new Error(`no ${cli}/${file}: bun run build:bin first`);

// Sidecars as Tauri wants them: each named for the target; the bundle drops the suffix. The engines
// get the app's prefix: a .deb puts them in /usr/bin, where whisper-server could be another package's.
rmSync(binaries, { recursive: true, force: true });
mkdirSync(binaries, { recursive: true });
copyFileSync(join(cli, `sprachanker${exe}`), join(binaries, `sprachanker-${triple}${exe}`));
for (const engine of ["whisper-server", "sherpa-onnx-offline-tts", "tts-server"]) {
  const file = `${engine}-${triple}${exe}`;
  if (!existsSync(join(cli, file)))
    throw new Error(`no ${file} beside the binary: bun run build:speech`);
  copyFileSync(join(cli, file), join(binaries, `sprachanker-${file}`));
}

// Resources: the third-party notices of the build (build:bin's, beside the binary) — in a Mac app's
// Contents/Resources, beside the program elsewhere — and on macOS the microphone's question in the
// languages of the catalogs (macOS asks it; zh: Simplified).
const NOTICES = "THIRD_PARTY_NOTICES.txt";
copyFileSync(join(cli, NOTICES), join(binaries, NOTICES));
const resources: Record<string, string> = { [`binaries/${NOTICES}`]: NOTICES };
if (system === "macos") {
  const MICROPHONE = "desktop.microphone";
  const i18n = join(here, "../web/src/i18n");
  for (const name of readdirSync(i18n).filter((n) => n.endsWith(".json"))) {
    const code = name.replace(".json", "");
    const question = (
      JSON.parse(readFileSync(join(i18n, name), "utf8")) as { desktop?: Record<string, string> }
    ).desktop?.[MICROPHONE.slice("desktop.".length)];
    if (!question) continue;
    const lproj = `${code === "zh" ? "zh-Hans" : code}.lproj`;
    mkdirSync(join(binaries, lproj), { recursive: true });
    writeFileSync(
      join(binaries, lproj, "InfoPlist.strings"),
      `"NSMicrophoneUsageDescription" = ${JSON.stringify(question)};\n`,
    );
    resources[`binaries/${lproj}/InfoPlist.strings`] = `${lproj}/InfoPlist.strings`;
  }
}

// The binary's version (MAJOR.MINOR.<commits>: apps/cli/scripts/version.ts) is the app's too.
const version = (await $`bun ${join(here, "../cli/scripts/version.ts")}`.text()).trim();
const bundles = { macos: "app", windows: "nsis", linux: "deb" }[system];
const config = { version, bundle: { resources } };
// Tauri's command line pinned in package.json (as the Rust crates are in Cargo.toml).
await $`bun x tauri build --bundles ${bundles} --config ${JSON.stringify(config)} -- --locked`
  .cwd(here)
  .env(env);
const bundled = join(tauri, "target/release/bundle");

const arch = triple.startsWith("aarch64") ? "arm64" : "x64";
const base = `SprachAnker-${version}-${system}-${arch}`;
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
/** A bundle's file into dist/ under its release name. */
const take = (from: string, name: string) => copyFileSync(from, join(out, name));
/** The one file of a bundle's folder ending so. */
function found(folder: string, ending: string) {
  const name = readdirSync(join(bundled, folder)).find((n) => n.endsWith(ending));
  if (!name) throw new Error(`no *${ending} in ${join(bundled, folder)}`);
  return join(bundled, folder, name);
}

if (system === "macos") {
  const app = join(bundled, "macos/SprachAnker.app");
  // The update file: the .app at the archive's top, as Tauri's updater unpacks it (no AppleDouble files).
  await $`tar -czf ${join(out, `${base}.app.tar.gz`)} -C ${join(bundled, "macos")} SprachAnker.app`.env(
    {
      ...process.env,
      COPYFILE_DISABLE: "1",
    },
  );
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
} else if (system === "windows") {
  take(found("nsis", "-setup.exe"), `${base}-setup.exe`);
} else {
  take(found("deb", ".deb"), `${base}.deb`);
}
console.log(`${out}: ${readdirSync(out).join(", ")}`);
