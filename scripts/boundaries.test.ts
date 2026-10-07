import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { cruise, type IReporterOutput } from "dependency-cruiser";
import config from "../.dependency-cruiser.cjs";

const fixtureRoot = resolve(import.meta.dir, "fixtures/boundaries");

async function violations(): Promise<string[]> {
  const result: IReporterOutput = await cruise(["packages", "apps", "courses"], {
    ...config.options,
    ruleSet: config,
    validate: true,
    baseDir: fixtureRoot,
  });
  if (typeof result.output === "string") throw new Error("expected a cruise result object");
  return result.output.summary.violations.map((v) => `${v.rule.name}: ${v.from} -> ${v.to}`).sort();
}

test("boundary rules fire on deliberate violations and allow the type-only AppType import", async () => {
  expect(await violations()).toEqual([
    "courses-import-schema-and-course-kit: courses/dw/src/imports-other.ts -> courses/lingust/src/index.ts",
    "engine-imports-schema-only: packages/engine/src/imports-server.ts -> packages/server/src/index.ts",
    "nothing-imports-apps: packages/server/src/imports-app.ts -> apps/web/src/server-type.ts",
    "pure-modules-no-io: packages/engine/src/uses-fs.ts -> fs",
    "pure-modules-no-io: packages/llm/src/uses-fs.ts -> fs",
    "server-io-in-runtime-only: packages/server/src/services/uses-fs.ts -> fs",
    "web-imports-server-types-only: apps/web/src/server-value.ts -> packages/server/src/index.ts",
    "web-llm-mounted-only: apps/web/src/lesson/uses-llm.ts -> apps/web/src/llm/tutor.ts",
    "web-ui-presentational: apps/web/src/ui/uses-api.ts -> apps/web/src/api/hooks.ts",
  ]);
});
