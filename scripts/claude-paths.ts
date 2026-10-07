// Finds repository paths mentioned in CLAUDE.md files that do not exist (spec 10, "Documentation rules").
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";

const REPO_PATH = /^(packages|apps|courses|native|docs|e2e)(\/|$)/;
const PLANNED = /\(planned\)/i;

/** Repository paths a CLAUDE.md mentions, minus the exempt ones. */
export function mentionedPaths(markdown: string): string[] {
  const paths: string[] = [];
  let heading = "";
  let inCode = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      if (heading.includes("(target)")) continue;
      paths.push(...line.split(/\s+/).filter((word) => REPO_PATH.test(word)));
      continue;
    }
    if (line.startsWith("#")) heading = line;
    if (PLANNED.test(line)) continue;
    for (const match of line.matchAll(/`([^`]+)`/g)) {
      const text = match[1]?.trim() ?? "";
      if (REPO_PATH.test(text)) paths.push(text);
    }
  }
  // A glob is checked up to its first wildcard; placeholders like <provider> are not checked.
  return paths.filter((path) => !path.includes("<")).map((path) => path.split("*")[0] ?? path);
}

/** `CLAUDE.md file: path` for every mentioned path that does not exist under `root`. */
export async function missingPaths(root: string): Promise<string[]> {
  const missing: string[] = [];
  for await (const file of new Glob("**/CLAUDE.md").scan({ cwd: root })) {
    if (file.includes("node_modules/")) continue;
    const markdown = await Bun.file(join(root, file)).text();
    for (const path of mentionedPaths(markdown)) {
      if (!existsSync(join(root, path))) missing.push(`${file}: ${path}`);
    }
  }
  return missing.sort();
}
