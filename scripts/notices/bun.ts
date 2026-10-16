// What Bun — compiled into the program — links, with each part's licence texts, for the Bun release
// package.json pins: the libraries its build fetches (scripts/build/deps at its tag; those built for
// macOS), its own vendored code, JavaScriptCore/WebKit (LGPL) and the Rust crates of its Cargo.lock
// (procedural macros and other systems' crates left out). Written to bun.json, read by inventory.ts;
// run again when Bun moves (check.ts fails until then). Needs `gh` (GitHub's API) and the network.
//   bun scripts/notices/bun.ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { chosen, readTexts } from "./notices.ts";

const ROOT = join(import.meta.dir, "..", "..");
const BUN = (
  JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    packageManager: string;
  }
).packageManager.split("@")[1] as string;
const TAG = `bun-v${BUN}`;

const LICENCE_FILE = /^(licen[cs]e|copying|notice|copyright)([-._].*)?$/i;

/** A file of a GitHub repository at a commit, or undefined. */
async function file(repo: string, ref: string, path: string) {
  const r = await $`gh api ${`repos/${repo}/contents/${path}?ref=${ref}`} --jq .content`
    .quiet()
    .nothrow();
  if (r.exitCode !== 0) return undefined;
  return Buffer.from(r.stdout.toString().replace(/\s/g, ""), "base64").toString("utf8");
}

/** The licence files at a folder of a repository at a commit. */
async function licences(repo: string, ref: string, dir = "") {
  const names = (
    await $`gh api ${`repos/${repo}/contents/${dir}?ref=${ref}`} --jq '.[] | select(.type=="file") | .name'`.text()
  )
    .trim()
    .split("\n")
    .filter((n) => LICENCE_FILE.test(n))
    .sort();
  const texts: string[] = [];
  for (const n of names) texts.push((await file(repo, ref, dir ? `${dir}/${n}` : n)) as string);
  return texts;
}

interface Part {
  name: string;
  version: string;
  licence: string;
  copyright?: string;
  source: string;
  texts: number[];
}
const texts: string[] = [];
const textId = (t: string) => {
  const key = t.replace(/\r\n?/g, "\n").trim();
  const at = texts.indexOf(key);
  if (at >= 0) return at;
  texts.push(key);
  return texts.length - 1;
};
const parts: Part[] = [];
const add = (p: Omit<Part, "texts">, t: string[]) => parts.push({ ...p, texts: t.map(textId) });

// The libraries Bun's build fetches: the pin of each (its <NAME>_COMMIT), those not limited to
// another system (`enabled:` naming windows, or SQLite built in only where the system has none).
const LIBRARY: Record<
  string,
  { name: string; licence: string; copyright?: string; standard?: string }
> = {
  boringssl: { name: "BoringSSL (Bun's fork)", licence: "Apache-2.0 AND ISC AND OpenSSL" },
  brotli: {
    name: "Brotli",
    licence: "MIT",
    copyright: "Copyright (c) 2009, 2010, 2013-2016 by the Brotli Authors",
  },
  cares: { name: "c-ares", licence: "MIT" },
  hdrhistogram: { name: "HdrHistogram_c", licence: "BSD-2-Clause OR CC0-1.0" },
  highway: { name: "Highway", licence: "Apache-2.0 OR BSD-3-Clause" },
  libarchive: { name: "libarchive", licence: "BSD-2-Clause and others (its COPYING)" },
  libdeflate: { name: "libdeflate", licence: "MIT" },
  "libjpeg-turbo": {
    name: "libjpeg-turbo",
    licence: "IJG AND BSD-3-Clause AND Zlib",
    copyright: "This software is based in part on the work of the Independent JPEG Group.",
  },
  libspng: { name: "libspng", licence: "BSD-2-Clause" },
  libwebp: { name: "libwebp", licence: "BSD-3-Clause" },
  lolhtml: { name: "lol-html (Bun's fork)", licence: "BSD-3-Clause" },
  lshpack: { name: "ls-hpack", licence: "MIT" },
  lsqpack: { name: "ls-qpack", licence: "MIT" },
  lsquic: { name: "LSQUIC", licence: "MIT AND BSD-3-Clause" },
  mimalloc: { name: "mimalloc (Bun's fork)", licence: "MIT" },
  picohttpparser: {
    name: "picohttpparser",
    licence: "MIT OR Artistic-1.0-Perl",
    copyright:
      "Copyright (c) 2009-2014 Kazuho Oku, Tokuhiro Matsuno, Daisuke Murase, Shigeo Mitsunari",
    standard: "MIT",
  },
  "rust-argon2": { name: "rust-argon2", licence: "MIT OR Apache-2.0" },
  tinycc: {
    name: "TinyCC (Bun's fork)",
    licence: "LGPL-2.1-or-later",
    copyright: "Copyright (c) 2001-2004 Fabrice Bellard and the TinyCC contributors",
  },
  zlib: { name: "zlib-ng", licence: "Zlib" },
  zstd: { name: "Zstandard", licence: "BSD-3-Clause (of BSD-3-Clause OR GPL-2.0)" },
};
const deps = (
  await $`gh api ${`repos/oven-sh/bun/contents/scripts/build/deps?ref=${TAG}`} --jq '.[].name'`.text()
)
  .trim()
  .split("\n")
  .filter((n) => n.endsWith(".ts") && n !== "index.ts")
  .sort();
for (const n of deps) {
  const dep = n.replace(/\.ts$/, "");
  const source = (await file("oven-sh/bun", TAG, `scripts/build/deps/${n}`)) as string;
  const repo = source.match(/repo:\s*"([^"]+)"/)?.[1];
  const commit = source.match(/_COMMIT\s*=\s*"([^"]+)"/)?.[1];
  const enabled = source.match(/enabled:\s*([^,\n]+)/)?.[1] ?? "";
  if (!repo || !commit || /windows|staticSqlite/.test(enabled)) continue;
  const known = LIBRARY[dep];
  if (!known) throw new Error(`Bun ${BUN} builds ${dep} (${repo}): name it in bun.ts's LIBRARY`);
  const t = await licences(repo, commit);
  // A library with its licence in its README and headers only: the standard text.
  if (!t.length && known.standard)
    t.push(readFileSync(join(import.meta.dir, "texts", `spdx-${known.standard}.txt`), "utf8"));
  if (!t.length) throw new Error(`${repo}@${commit}: no licence file`);
  if (dep === "zstd") t.splice(0, t.length, ...t.filter((x) => !/GNU GENERAL PUBLIC/.test(x)));
  add(
    { ...known, version: `commit ${commit}`, source: `https://github.com/${repo}/tree/${commit}` },
    t,
  );
}

// Bun's own vendored code, and the work its transpiler is ported from.
for (const [name, path] of [
  ["uSockets (Bun's fork)", "packages/bun-usockets"],
  ["uWebSockets (Bun's fork)", "packages/bun-uws"],
  ["clap (Bun's port)", "src/clap"],
] as const)
  add(
    {
      name,
      version: TAG,
      licence: "Apache-2.0 / MIT",
      source: `https://github.com/oven-sh/bun/tree/${TAG}/${path}`,
    },
    await licences("oven-sh/bun", TAG, path),
  );
add(
  {
    name: "esbuild (Bun's transpiler, CSS lexer and module resolver are ported from it)",
    version: "—",
    licence: "MIT",
    copyright: "Copyright (c) 2020 Evan Wallace",
    source: "https://github.com/evanw/esbuild",
  },
  await licences("evanw/esbuild", "main"),
);

// JavaScriptCore and WTF (WebKit): LGPL-2.0-or-later and BSD-2-Clause files.
const webkit = (await file("oven-sh/bun", TAG, "scripts/build/deps/webkit.ts"))?.match(
  /WEBKIT_VERSION\s*=\s*"([^"]+)"/,
)?.[1];
if (!webkit) throw new Error("WebKit's version not found");
const lgpl = await file("oven-sh/WebKit", webkit, "Source/JavaScriptCore/COPYING.LIB");
const apple = await file("oven-sh/WebKit", webkit, "Source/WebCore/LICENSE-APPLE");
if (!lgpl || !apple) throw new Error("WebKit's licence files not found");
add(
  {
    name: "JavaScriptCore and WTF (WebKit, Bun's fork)",
    version: `commit ${webkit}`,
    licence: "LGPL-2.0-or-later AND BSD-2-Clause",
    copyright:
      "Copyright (C) 1999-2001 Harri Porten, 2001 Peter Kelly, 2003-2024 Apple Inc. and the WebKit contributors; dtoa: Copyright (c) 1991, 2000, 2001 Lucent Technologies (David M. Gay)",
    source: `https://github.com/oven-sh/WebKit/tree/${webkit}`,
  },
  [lgpl, apple],
);

// The Rust crates of Bun's Cargo.lock, each crate's own licence files.
const lock = (await file("oven-sh/bun", TAG, "Cargo.lock")) as string;
const OTHER_SYSTEMS = /^(windows|winapi|wasm|wasi|wit-|js-sys|web-sys|r-efi|hermit-abi)/;
const work = mkdtempSync(join(tmpdir(), "bun-crates-"));
for (const m of lock.matchAll(
  /\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"\nsource = "registry/g,
)) {
  const [, name, version] = m as unknown as [string, string, string];
  if (OTHER_SYSTEMS.test(name)) continue;
  const archive = join(work, `${name}-${version}.crate`);
  await $`curl -fsSL -o ${archive} ${`https://static.crates.io/crates/${name}/${name}-${version}.crate`}`;
  await $`tar -xzf ${archive} -C ${work}`;
  const dir = join(work, `${name}-${version}`);
  const manifest = readFileSync(join(dir, "Cargo.toml"), "utf8");
  if (/^proc-macro\s*=\s*true/m.test(manifest)) continue;
  const licence = manifest.match(/^license\s*=\s*"([^"]+)"/m)?.[1] ?? "see its files";
  const authors = manifest
    .match(/^authors\s*=\s*\[([^\]]*)\]/m)?.[1]
    ?.replace(/"/g, "")
    .trim();
  add(
    {
      name: `${name} (crate in Bun)`,
      version,
      licence,
      copyright: authors || undefined,
      source: `https://crates.io/crates/${name}/${version}`,
    },
    // As the generator reads a crate: the chosen licence's files, else the standard text.
    readTexts(dir, chosen(licence)),
  );
}
rmSync(work, { recursive: true, force: true });

writeFileSync(
  join(import.meta.dir, "bun.json"),
  `${JSON.stringify({ bun: BUN, parts, texts }, null, 1)}\n`,
);
console.log(`Bun ${BUN}: ${parts.length} parts, ${texts.length} texts → scripts/notices/bun.json`);
