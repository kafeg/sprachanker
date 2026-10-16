// THIRD_PARTY_NOTICES.txt: every third-party component the builds carry — its version, licence,
// copyright, the link to its exact source and the builds it is in —, then each licence text once.
// From the hand-kept inventory (inventory.ts: the engines, the runtime, Android's libraries, what the
// app downloads), the JavaScript packages the shipped workspaces depend on (bun.lock, their texts
// from node_modules) and the Rust crates of the desktop and phone apps (`cargo metadata`, their texts
// from cargo's registry). The same inputs give the same file. Run by the builds that ship it:
//   bun scripts/notices/notices.ts <file>...
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { $ } from "bun";
import { downloads } from "./downloads.ts";
import {
  ANDROID,
  BUILDS,
  type Build,
  type Component,
  type Group,
  NATIVE,
  RUNTIME,
  SOURCE_OFFER,
  spdx,
} from "./inventory.ts";

const ROOT = join(import.meta.dir, "..", "..");

/** The workspaces whose code a build carries: the web app, the program (the server and all it
 *  imports), the phone app's page. Their `dependencies` are followed, never `devDependencies`. */
const SHIPPED_WORKSPACES = ["apps/web", "apps/cli", "apps/mobile"];

/** A licence's standard text, for a package that ships none (its holders named in the entry). */
const STANDARD: Record<string, string> = {
  MIT: "MIT",
  "Apache-2.0": "Apache-2.0",
  ISC: "ISC",
  "BSD-2-Clause": "BSD-2-Clause",
  "BSD-3-Clause": "BSD-3-Clause",
  Zlib: "Zlib",
  "MPL-2.0": "MPL-2.0",
  "0BSD": "0BSD",
  Unlicense: "Unlicense",
  "MIT-0": "MIT-0",
  "CC0-1.0": "CC0-1.0",
  "BSL-1.0": "BSL-1.0",
  "OFL-1.1": "OFL-1.1",
  "Unicode-3.0": "Unicode-3.0",
};

/** Of a licence expression offering a choice, the licence used here: MIT where offered, else
 *  Apache-2.0, else the first; an expression requiring several (AND) is kept whole. */
export function chosen(expression: string): string {
  const e = expression.replace(/[()]/g, "").replace(/\//g, " OR ").trim();
  if (/\bAND\b/.test(e)) return expression;
  const options = e.split(/\s+OR\s+/).map((o) => o.trim());
  return (
    options.find((o) => o === "MIT") ?? options.find((o) => o === "Apache-2.0") ?? options[0] ?? e
  );
}

const LICENCE_FILE = /^(licen[cs]e|copying|notice|copyright)([-._].*)?$/i;

/** The licence files of a package folder: those of the chosen licence when it ships one per
 *  licence (LICENSE-MIT, LICENSE-APACHE), else all of them; NOTICE files always. */
export function licenceFiles(dir: string, licence: string): string[] {
  const files = readdirSync(dir)
    .filter((f) => LICENCE_FILE.test(f) && statSync(join(dir, f)).isFile())
    .sort();
  const notices = files.filter((f) => /^notice/i.test(f));
  const rest = files.filter((f) => !/^notice/i.test(f));
  const key = licence
    .toLowerCase()
    .replace(/-2\.0$/, "")
    .replace(/-clause$/, "");
  const own = rest.filter((f) => f.toLowerCase().includes(key));
  const perLicence = rest.some((f) => /[-._](mit|apache|bsd|zlib|unlicen)/i.test(f));
  return [...(perLicence && own.length ? own : rest), ...notices];
}

function readTexts(dir: string, licence: string) {
  const texts = licenceFiles(dir, licence).map((f) => readFileSync(join(dir, f), "utf8"));
  if (texts.length) return texts;
  const standard = STANDARD[licence];
  if (!standard) throw new Error(`${dir}: no licence file and no standard text for "${licence}"`);
  return [spdx(standard)];
}

// ---- JavaScript: bun.lock ------------------------------------------------------------------------

type LockPackage = [string, string, { dependencies?: Record<string, string> }?, string?];
interface Lock {
  workspaces: Record<string, { dependencies?: Record<string, string> }>;
  packages: Record<string, LockPackage>;
}

/** The packages (name@version) the shipped workspaces depend on, through other workspaces and
 *  packages, by bun.lock's resolution: a dependency of `a/b` is `a/b/dep`, else `a/dep`, else `dep`. */
export function lockPackages(lock: Lock, workspaces = SHIPPED_WORKSPACES): string[] {
  const resolve = (from: string, dep: string) => {
    let base = from ? from.split("/") : [];
    for (;;) {
      const key = [...base, dep].join("/");
      if (lock.packages[key]) return key;
      if (!base.length) return undefined;
      // A scoped name is two segments.
      const cut = base.length >= 2 && base[base.length - 2]?.startsWith("@") ? 2 : 1;
      base = base.slice(0, -cut);
    }
  };
  const seenWorkspaces = new Set<string>();
  const queue: Array<[string, string]> = [];
  const workspace = (path: string) => {
    if (seenWorkspaces.has(path)) return;
    seenWorkspaces.add(path);
    const ws = lock.workspaces[path];
    if (!ws) throw new Error(`bun.lock has no workspace ${path}`);
    for (const dep of Object.keys(ws.dependencies ?? {})) queue.push(["", dep]);
  };
  for (const path of workspaces) workspace(path);
  const seen = new Set<string>();
  const found = new Set<string>();
  while (queue.length) {
    const [from, dep] = queue.pop() as [string, string];
    const key = resolve(from, dep);
    if (!key) throw new Error(`bun.lock does not resolve ${dep} (from ${from || "a workspace"})`);
    const [spec, , info] = lock.packages[key] as LockPackage;
    const at = spec.lastIndexOf("@");
    if (spec.slice(at + 1).startsWith("workspace:")) {
      workspace(spec.slice(at + 1 + "workspace:".length));
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    found.add(spec);
    for (const d of Object.keys(info?.dependencies ?? {})) queue.push([key, d]);
  }
  return [...found].sort();
}

/** Installed packages' folders by name@version: Bun's isolated store (node_modules/.bun), else the
 *  hoisted node_modules. */
function packageFolders(root: string) {
  const folders = new Map<string, string>();
  const add = (dir: string) => {
    const file = join(dir, "package.json");
    if (!existsSync(file)) return;
    const pkg = JSON.parse(readFileSync(file, "utf8")) as { name?: string; version?: string };
    if (pkg.name && pkg.version) folders.set(`${pkg.name}@${pkg.version}`, dir);
  };
  const store = join(root, "node_modules", ".bun");
  if (existsSync(store))
    for (const entry of readdirSync(store)) {
      const modules = join(store, entry, "node_modules");
      if (!existsSync(modules)) continue;
      for (const name of readdirSync(modules)) {
        if (name.startsWith("@"))
          for (const sub of readdirSync(join(modules, name))) add(join(modules, name, sub));
        else add(join(modules, name));
      }
    }
  const top = join(root, "node_modules");
  if (existsSync(top))
    for (const name of readdirSync(top)) {
      if (name.startsWith(".")) continue;
      if (name.startsWith("@"))
        for (const sub of readdirSync(join(top, name))) add(join(top, name, sub));
      else add(join(top, name));
    }
  return folders;
}

type Person = string | { name?: string };
const person = (p: Person | undefined) => (typeof p === "string" ? p : p?.name);

export function jsComponents(root = ROOT): Component[] {
  const lock = Bun.JSONC.parse(readFileSync(join(root, "bun.lock"), "utf8")) as Lock;
  const folders = packageFolders(root);
  return lockPackages(lock).map((spec) => {
    const dir = folders.get(spec);
    if (!dir) throw new Error(`${spec} is not installed: bun install first`);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      name: string;
      version: string;
      license?: string | { type: string };
      author?: Person;
    };
    const licence =
      typeof pkg.license === "string" ? pkg.license : (pkg.license?.type ?? "UNKNOWN");
    const holders = person(pkg.author);
    return {
      group: "js",
      name: pkg.name,
      version: pkg.version,
      licence,
      copyright: holders,
      source: `https://www.npmjs.com/package/${pkg.name}/v/${pkg.version}`,
      builds: [...BUILDS],
      texts: readTexts(dir, chosen(licence)),
    };
  });
}

// ---- Rust: cargo metadata -----------------------------------------------------------------------

interface CargoPackage {
  id: string;
  name: string;
  version: string;
  license: string | null;
  license_file: string | null;
  authors: string[];
  manifest_path: string;
  links: string | null;
  source: string | null;
  targets: Array<{ kind: string[] }>;
}
interface Metadata {
  packages: CargoPackage[];
  workspace_members: string[];
  resolve: {
    nodes: Array<{
      id: string;
      deps: Array<{ pkg: string; dep_kinds: Array<{ kind: string | null }> }>;
    }>;
  };
}

/** The crates a binary links: the workspace's normal dependencies, followed (build and dev
 *  dependencies and procedural macros run at build time only). */
export function linkedCrates(metadata: Metadata): CargoPackage[] {
  const packages = new Map(metadata.packages.map((p) => [p.id, p]));
  const nodes = new Map(metadata.resolve.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const stack = [...metadata.workspace_members];
  while (stack.length) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    const pkg = packages.get(id);
    if (pkg?.targets.some((t) => t.kind.includes("proc-macro"))) continue;
    seen.add(id);
    for (const dep of nodes.get(id)?.deps ?? [])
      if (dep.dep_kinds.some((k) => k.kind === null)) stack.push(dep.pkg);
  }
  const members = new Set(metadata.workspace_members);
  return [...seen].filter((id) => !members.has(id)).map((id) => packages.get(id) as CargoPackage);
}

/** Cargo, where rustup puts it (as apps/desktop/scripts/build.ts finds it). */
const cargoEnv = () => ({
  ...process.env,
  PATH: ["/opt/homebrew/opt/rustup/bin", join(homedir(), ".cargo", "bin"), process.env.PATH].join(
    ":",
  ),
});

/** The desktop app's and the phone app's crates, by name@version with the builds each is in. */
export async function rustComponents(root = ROOT): Promise<Component[]> {
  const apps: Array<[string, string, Build[]]> = [
    ["apps/desktop/src-tauri", "aarch64-apple-darwin", ["mac"]],
    ["apps/mobile/src-tauri", "aarch64-linux-android", ["android"]],
  ];
  const crates = new Map<string, Component>();
  for (const [dir, target, builds] of apps) {
    const metadata =
      (await $`cargo metadata --format-version 1 --locked --filter-platform ${target}`
        .cwd(join(root, dir))
        .env(cargoEnv())
        .quiet()
        .json()) as Metadata;
    for (const crate of linkedCrates(metadata)) {
      const key = `${crate.name}@${crate.version}`;
      const known = crates.get(key);
      if (known) {
        known.builds = [...new Set([...known.builds, ...builds])];
        continue;
      }
      const folder = dirname(crate.manifest_path);
      const licence = crate.license ?? "UNKNOWN";
      const holders = crate.authors.join(", ") || undefined;
      const texts = crate.license_file
        ? [readFileSync(join(folder, crate.license_file), "utf8")]
        : readTexts(folder, chosen(licence));
      // A crate building a C library carries that library's licence in its folder.
      if (crate.links)
        for (const sub of readdirSync(folder).sort()) {
          const inner = join(folder, sub);
          if (statSync(inner).isDirectory())
            for (const f of licenceFiles(inner, ""))
              texts.push(readFileSync(join(inner, f), "utf8"));
        }
      crates.set(key, {
        group: "rust",
        name: crate.name,
        version: crate.version,
        licence,
        copyright: holders,
        source: `https://crates.io/crates/${crate.name}/${crate.version}`,
        builds,
        texts,
      });
    }
  }
  // The standard library goes into every Rust binary: the toolchain's own.
  const rustc = (await $`rustc --version`.env(cargoEnv()).text()).split(" ")[1] ?? "?";
  crates.set("std", {
    group: "rust",
    name: "Rust standard library",
    version: rustc,
    licence: "MIT OR Apache-2.0",
    copyright: "The Rust Project Developers",
    source: `https://github.com/rust-lang/rust/tree/${rustc}/library`,
    builds: apps.flatMap(([, , builds]) => builds),
    texts: [spdx("MIT")],
  });
  return [...crates.values()];
}

// ---- The file -----------------------------------------------------------------------------------

const BUILD_NAMES: Record<Build, string> = {
  program: "program",
  mac: "Mac app",
  android: "Android app",
};

const GROUPS: Array<[Group, string]> = [
  ["native", "Speech engines and the native libraries in them"],
  ["runtime", "The program's runtime"],
  [
    "js",
    "JavaScript libraries (the app's pages; the server's code in the program and the Android app)",
  ],
  ["rust", "Rust crates (the Mac app's window; the Android app)"],
  ["android", "Android libraries (the Android app)"],
  ["download", "Downloaded by the app when you choose them (not part of any build)"],
];

const RULE = "=".repeat(78);
const normalised = (t: string) => t.replace(/\r\n?/g, "\n").replace(/^﻿/, "").trim();

/** The notices file: a header, the components by group (sorted), then each distinct licence text
 *  once, numbered in order of first use. */
export function render(components: Component[], downloads = ""): string {
  const ids = new Map<string, number>();
  const textList: string[] = [];
  const used = new Map<number, string[]>();
  const sorted = [...components].sort(
    (a, b) =>
      GROUPS.findIndex(([g]) => g === a.group) - GROUPS.findIndex(([g]) => g === b.group) ||
      a.name.localeCompare(b.name, "en") ||
      a.version.localeCompare(b.version, "en"),
  );
  const out = [
    "SprachAnker — third-party components and their licences",
    RULE,
    "",
    "SprachAnker is under the MIT licence (https://github.com/kafeg/sprachanker). Its builds carry the",
    "components below, each under its own licence. The builds: “program” — the sprachanker program",
    "and the speech engines beside it (sprachanker-macos-arm64.tar.gz); “Mac app” — SprachAnker.app,",
    "the same program and engines inside; “Android app” — the APK.",
    "",
    SOURCE_OFFER,
    "",
  ];
  for (const [group, title] of GROUPS) {
    const members = sorted.filter((c) => c.group === group);
    if (group === "download") {
      if (downloads) out.push(RULE, title, RULE, "", downloads.trim(), "");
      continue;
    }
    if (!members.length) continue;
    out.push(RULE, title, RULE, "");
    for (const c of members) {
      const refs = c.texts.map((t) => {
        const key = normalised(t);
        let id = ids.get(key);
        if (id === undefined) {
          id = textList.length + 1;
          ids.set(key, id);
          textList.push(key);
        }
        used.set(id, [...(used.get(id) ?? []), `${c.name} ${c.version}`]);
        return `[${id}]`;
      });
      out.push(`${c.name} ${c.version}`);
      out.push(`  Licence: ${c.licence}`);
      if (c.copyright) out.push(`  Copyright: ${c.copyright.replace(/\s+/g, " ").trim()}`);
      out.push(`  Source: ${c.source}`);
      out.push(
        `  In: ${BUILDS.filter((b) => c.builds.includes(b))
          .map((b) => BUILD_NAMES[b])
          .join(", ")}${c.where ? ` — ${c.where}` : ""}`,
      );
      if (c.note) out.push(`  Note: ${c.note}`);
      out.push(`  Licence text: ${refs.join(" ")}`, "");
    }
  }
  out.push(RULE, "Licence texts", RULE, "");
  textList.forEach((t, i) => {
    out.push(`[${i + 1}]`, "-".repeat(78), t, "");
  });
  return `${out.join("\n").trimEnd()}\n`;
}

/** Every component of every build, gathered from the repository. */
export async function components(root = ROOT): Promise<Component[]> {
  return [
    ...NATIVE,
    ...RUNTIME,
    ...ANDROID,
    ...jsComponents(root),
    ...(await rustComponents(root)),
  ];
}

if (import.meta.main) {
  const outs = process.argv.slice(2);
  if (!outs.length) throw new Error("usage: bun scripts/notices/notices.ts <file>...");
  const file = render(await components(), downloads());
  for (const out of outs) writeFileSync(out, file);
  console.log(`THIRD_PARTY_NOTICES: ${(file.length / 1024).toFixed(0)} KB → ${outs.join(", ")}`);
}
