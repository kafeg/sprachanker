// Finds paths mentioned in CLAUDE.md files that do not exist: backticked
// repository paths in the text, and every entry of a "## Layout" tree — read as a tree of folders and
// files relative to the CLAUDE.md's own folder (a root line naming a repository path starts from the
// repository's root).
// What is not built yet goes in a "## Planned" list, which is not checked.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { Glob } from "bun";

const REPO_PATH = /^(packages|apps|courses|native|docs|e2e)(\/|$)/;
const PLANNED = /\(planned\)/i;

/** Repository paths a CLAUDE.md in `dir` (repo-relative, "" for the root) mentions. */
export function mentionedPaths(markdown: string, dir = ""): string[] {
  const paths: string[] = [];
  let heading = "";
  let inCode = false;
  /** The open folders of a Layout tree, by indentation. */
  let tree: Array<{ indent: number; path: string }> = [];
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      inCode = !inCode;
      tree = [];
      continue;
    }
    if (inCode) {
      if (/^##\s+Layout\b/.test(heading)) {
        const entry = layoutEntry(line, dir, tree);
        if (entry) paths.push(entry);
      } else paths.push(...line.split(/\s+/).filter((word) => REPO_PATH.test(word)));
      continue;
    }
    if (line.startsWith("#")) heading = line;
    if (PLANNED.test(line) || /^##\s+Planned\b/.test(heading)) continue;
    for (const match of line.matchAll(/`([^`]+)`/g)) {
      const text = match[1]?.trim() ?? "";
      if (REPO_PATH.test(text)) paths.push(text);
    }
  }
  // A glob is checked up to its first wildcard; placeholders like <provider> are not checked.
  return paths.filter((path) => !path.includes("<")).map((path) => path.split("*")[0] ?? path);
}

/** The path a line of a Layout tree names, its folder opened for the lines indented under it. A line
 *  starting with "#" (or only spaces before one) continues the comment above. */
function layoutEntry(line: string, dir: string, tree: Array<{ indent: number; path: string }>) {
  const match = /^(\s*)([^\s#]+)/.exec(line);
  if (!match) return undefined;
  const indent = match[1]?.length ?? 0;
  const name = match[2] ?? "";
  while (tree.length && (tree.at(-1)?.indent ?? 0) >= indent) tree.pop();
  const parent = tree.at(-1)?.path ?? dir;
  // Only an entry at the tree's root names a path from the repository's root: a folder deeper in
  // (a provider's own `docs/`) is inside its parent.
  const path = indent === 0 && REPO_PATH.test(name) ? name : join(parent, name);
  if (name.endsWith("/")) tree.push({ indent, path });
  return path;
}

/** `CLAUDE.md file: path` for every mentioned path that does not exist under `root`. */
export async function missingPaths(root: string): Promise<string[]> {
  const missing: string[] = [];
  for await (const file of new Glob("**/CLAUDE.md").scan({ cwd: root })) {
    if (file.includes("node_modules/")) continue;
    const markdown = await Bun.file(join(root, file)).text();
    const dir = dirname(file) === "." ? "" : dirname(file);
    for (const path of mentionedPaths(markdown, dir)) {
      if (!existsSync(join(root, path))) missing.push(`${file}: ${path}`);
    }
  }
  return missing.sort();
}
