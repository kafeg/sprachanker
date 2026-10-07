import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { mentionedPaths, missingPaths } from "./claude-paths.ts";

test("collects backticked repository paths and applies the exemptions", () => {
  const markdown = [
    "# Area",
    "Uses `packages/schema` and `apps/web/src/i18n/`, runs `bun test`, see `courses/*`.",
    "`packages/anki-export` (planned).",
    "Per provider: `courses/<provider>/fixtures`.",
    "```",
    "e2e/smoke.spec.ts   # checked: not under a (target) heading",
    "```",
    "## Layout (target)",
    "```",
    "packages/not-yet/   # exempt",
    "```",
  ].join("\n");
  expect(mentionedPaths(markdown)).toEqual([
    "packages/schema",
    "apps/web/src/i18n/",
    "courses/",
    "e2e/smoke.spec.ts",
  ]);
});

test("every repository path mentioned in a CLAUDE.md exists", async () => {
  expect(await missingPaths(resolve(import.meta.dir, ".."))).toEqual([]);
});
