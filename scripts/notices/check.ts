// What the builds ship that the hand-kept inventory must name, read cheaply from the repository:
// each speech engine at its pinned VERSION, Bun at package.json's version, ONNX Runtime at the
// version the phone's build checks, every Android library the Gradle build declares (the list
// resolved with the phone app's tauri), what Bun links (bun.json, for package.json's Bun), every
// Piper voice's licence. notices.test.ts runs it (bun run check); a problem each line.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ENGINES } from "../../packages/server/src/runtime/engines.ts";
import { voicesWithoutLicence } from "./downloads.ts";
import { ANDROID_RESOLVED_WITH_TAURI, type Component } from "./inventory.ts";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

export function missingEntries(inventory: Component[], androidDeclared: string[]): string[] {
  const problems: string[] = [];
  for (const [name, { folder, program }] of Object.entries(ENGINES)) {
    const version = read(`native/${folder}/VERSION`).trim();
    const entry = inventory.find((c) => c.engine === name);
    if (!entry) problems.push(`${program} (native/${folder}) has no entry`);
    else if (!entry.version.includes(version))
      problems.push(`${entry.name} is ${entry.version}, native/${folder}/VERSION ${version}`);
  }
  const bun = (JSON.parse(read("package.json")) as { packageManager: string }).packageManager.split(
    "@",
  )[1];
  const runtime = inventory.find((c) => c.name === "Bun");
  if (runtime?.version !== bun) problems.push(`Bun is ${runtime?.version}, package.json's ${bun}`);
  const sums = read("native/scripts/build.ts").match(
    /ONNX_RUNTIME_SHA256[^=]*=\s*\{([^}]*)\}/,
  )?.[1];
  const ort = [...(sums ?? "").matchAll(/"([\d.]+)":/g)].map((m) => m[1] as string);
  if (!ort.length) problems.push("native/scripts/build.ts pins no ONNX Runtime");
  const onnx = inventory.find((c) => c.name.startsWith("ONNX Runtime"));
  for (const version of ort)
    if (onnx?.version !== version)
      problems.push(`ONNX Runtime is ${onnx?.version}, the phone's build takes ${version}`);
  const gradle = [
    ...read("apps/mobile/src-tauri/gen/android/app/build.gradle.kts").matchAll(
      /^\s*implementation\("([^"]+)"\)/gm,
    ),
  ].map((m) => m[1] as string);
  for (const lib of gradle)
    if (!androidDeclared.includes(lib)) problems.push(`Android library ${lib} has no entry`);
  const tauri = read("apps/mobile/src-tauri/Cargo.lock").match(
    /\[\[package\]\]\nname = "tauri"\nversion = "([^"]+)"/,
  )?.[1];
  if (tauri !== ANDROID_RESOLVED_WITH_TAURI)
    problems.push(
      `the Android libraries were resolved with tauri ${ANDROID_RESOLVED_WITH_TAURI}, the phone app takes ${tauri}`,
    );
  for (const id of voicesWithoutLicence()) problems.push(`Piper voice ${id} names no licence`);
  for (const c of inventory) if (!c.texts.length) problems.push(`${c.name} has no licence text`);
  return problems;
}
