import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { mentionedPaths, missingPaths } from "./claude-paths.ts";

test("collects backticked repository paths and every entry of a Layout tree; Planned is not checked", () => {
  const markdown = [
    "# Area",
    "Uses `packages/schema` and `apps/web/src/i18n/`, runs `bun test`, see `courses/*`.",
    "`packages/anki-export` (planned).",
    "Per provider: `courses/<provider>/fixtures`.",
    "```",
    "e2e/smoke.spec.ts   # a repository path in any code block",
    "```",
    "## Layout",
    "```",
    "src/",
    "  routes/          # a folder in src",
    "                   # (a comment going on)",
    "    page.tsx",
    "  api.ts",
    "test/",
    "e2e/flow.e2e.ts    # from the root",
    "```",
    "## Planned",
    "- `packages/not-yet/` and a tree of it",
  ].join("\n");
  expect(mentionedPaths(markdown, "apps/web")).toEqual([
    "packages/schema",
    "apps/web/src/i18n/",
    "courses/",
    "e2e/smoke.spec.ts",
    "apps/web/src/",
    "apps/web/src/routes/",
    "apps/web/src/routes/page.tsx",
    "apps/web/src/api.ts",
    "apps/web/test/",
    "e2e/flow.e2e.ts",
  ]);
});

test("every repository path mentioned in a CLAUDE.md exists", async () => {
  expect(await missingPaths(resolve(import.meta.dir, ".."))).toEqual([]);
});
