// latest.json, what the desktop app's updater reads at the latest release (tauri.conf.json's
// endpoint): the release's version and, for each system, the file it updates itself from with that
// file's signature (scripts/build.ts signs them). From the release's files gathered in one folder.
//   bun scripts/latest.ts <tag vX.Y.N> <folder>     (writes <folder>/latest.json)
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Each updater target (`{os}-{arch}`, `{os}-{arch}-{bundle}`) and the release file it takes. */
const TARGETS: Array<[string[], RegExp]> = [
  [["darwin-aarch64", "darwin-aarch64-app"], /-macos-arm64\.app\.tar\.gz$/],
  [["windows-x86_64", "windows-x86_64-nsis"], /-windows-x64-setup\.exe$/],
  [["linux-x86_64", "linux-x86_64-deb"], /-linux-x64\.deb$/],
];

export function latest(tag: string, files: string[], signature: (file: string) => string) {
  const version = tag.replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`not a version tag: ${tag}`);
  const platforms: Record<string, { url: string; signature: string }> = {};
  for (const [targets, pattern] of TARGETS) {
    const file = files.find((f) => pattern.test(f) && f.includes(`-${version}-`));
    if (!file) throw new Error(`no file for ${targets[0]} (${pattern})`);
    const entry = {
      url: `https://github.com/kafeg/sprachanker/releases/download/${tag}/${file}`,
      signature: signature(file),
    };
    for (const target of targets) platforms[target] = entry;
  }
  return {
    version,
    notes: `https://github.com/kafeg/sprachanker/releases/tag/${tag}`,
    pub_date: new Date().toISOString(),
    platforms,
  };
}

if (import.meta.main) {
  const [tag, folder] = process.argv.slice(2);
  if (!tag || !folder) throw new Error("usage: bun scripts/latest.ts <tag> <folder>");
  const files = readdirSync(folder);
  const json = latest(tag, files, (file) => {
    const sig = join(folder, `${file}.sig`);
    if (!existsSync(sig)) throw new Error(`${file} has no signature`);
    return readFileSync(sig, "utf8").trim();
  });
  writeFileSync(join(folder, "latest.json"), `${JSON.stringify(json, null, 2)}\n`);
  console.log(`${folder}/latest.json: ${json.version}, ${Object.keys(json.platforms).join(", ")}`);
}
