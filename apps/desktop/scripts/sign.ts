// The files the desktop app updates itself from, signed with the updater's key — in a step of its own,
// after the build, so the key is in no build's environment: `tauri signer sign` with the version bound
// into each signature (what requireSignedVersion checks). Each signature is then checked: made by the
// key whose public half is in tauri.conf.json (a wrong key would ship updates every app refuses), and
// naming this version.
//   TAURI_SIGNING_PRIVATE_KEY=… TAURI_SIGNING_PRIVATE_KEY_PASSWORD=… bun scripts/sign.ts <folder>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

/** The files an app updates itself from, as build.ts names them. */
export const UPDATE_FILE = /-(macos-arm64\.app\.tar\.gz|windows-x64-setup\.exe|linux-x64\.deb)$/;

/** A minisign key's or signature's id: bytes 2–10 of its base64 line (after "Ed"). */
const idOf = (line: string) => Buffer.from(line.trim(), "base64").subarray(2, 10).toString("hex");

/** What a signature (Tauri's .sig: base64 of minisign's text) says: its key id and trusted comment. */
export function signatureOf(sig: string) {
  const lines = Buffer.from(sig.trim(), "base64").toString("utf8").split("\n");
  return {
    key: idOf(lines[1] ?? ""),
    trusted: (lines[2] ?? "").replace(/^trusted comment: /, ""),
  };
}

/** The key id of the public key in tauri.conf.json (base64 of minisign's public key text). */
export function publicKeyId(pubkey: string) {
  const lines = Buffer.from(pubkey, "base64").toString("utf8").split("\n");
  return idOf(lines[1] ?? "");
}

/** Why a signature does not fit (another key, another version), or undefined when it does. */
export function wrongSignature(sig: string, pubkey: string, version: string) {
  const { key, trusted } = signatureOf(sig);
  if (key !== publicKeyId(pubkey))
    return `signed by key ${key}, not the app's ${publicKeyId(pubkey)}`;
  if (!trusted.split("\t").includes(`version:${version}`)) return `not signed for ${version}`;
  return undefined;
}

if (import.meta.main) {
  const folder = process.argv[2];
  if (!folder) throw new Error("usage: bun scripts/sign.ts <folder>");
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY)
    throw new Error("TAURI_SIGNING_PRIVATE_KEY is not set");
  const here = join(import.meta.dir, "..");
  const conf = JSON.parse(readFileSync(join(here, "src-tauri/tauri.conf.json"), "utf8")) as {
    plugins: { updater: { pubkey: string } };
  };
  const files = readdirSync(folder).filter((f) => UPDATE_FILE.test(f));
  if (!files.length) throw new Error(`no update file in ${folder}`);
  for (const file of files) {
    const version = file.match(/^SprachAnker-(\d+\.\d+\.\d+)-/)?.[1];
    if (!version) throw new Error(`no version in ${file}`);
    const path = join(folder, file);
    await $`bun x tauri signer sign --app-version ${version} ${path}`.cwd(here).quiet();
    const wrong = wrongSignature(
      readFileSync(`${path}.sig`, "utf8"),
      conf.plugins.updater.pubkey,
      version,
    );
    if (wrong) throw new Error(`${file}: ${wrong}`);
    console.log(`signed ${file}`);
  }
}
