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
    "course-kit-and-courses-node-free: packages/course-kit/src/library.ts -> fs",
    "course-kit-never-imports-courses: packages/course-kit/test/uses-course.test.ts -> courses/lingust/src/index.ts",
    "courses-import-schema-and-course-kit: courses/dw/src/imports-other.ts -> courses/lingust/src/index.ts",
    "engine-folders-one-way: packages/engine/src/srs/reads-learner.ts -> packages/engine/src/learner/activity.ts",
    "engine-imports-schema-only: packages/engine/src/imports-server.ts -> packages/server/src/index.ts",
    "nothing-imports-apps: packages/server/src/imports-app.ts -> apps/web/src/server-type.ts",
    "pure-modules-no-io: packages/anki-export/src/uses-fs.ts -> fs",
    "pure-modules-no-io: packages/engine/src/uses-fs.ts -> fs",
    "pure-modules-no-io: packages/llm/src/uses-fs.ts -> fs",
    "server-app-never-reaches-storage: packages/server/src/services/uses-storage.ts -> packages/server/src/storage/decks.ts",
    "server-app-reaches-course-kit-view-only: packages/server/src/services/uses-library.ts -> packages/course-kit/src/library.ts",
    "server-exams-apart: packages/server/src/services/exam-rating.ts -> packages/server/src/services/study.ts",
    "server-io-in-runtime-only: packages/server/src/services/uses-fs.ts -> fs",
    "server-lessons-apart: packages/server/src/services/mistakes.ts -> packages/server/src/services/study.ts",
    "server-notebook-gathers: packages/server/src/services/notebook.ts -> packages/server/src/services/lessons.ts",
    "server-review-apart: packages/server/src/services/words.ts -> packages/server/src/services/lessons.ts",
    "server-tables-through-stores: packages/server/src/services/reads-events.ts -> packages/server/src/db/profile/schema.ts",
    "web-api-below-features: apps/web/src/api/uses-feature.ts -> apps/web/src/courses/card.ts",
    "web-features-apart: apps/web/src/exams/uses-courses.ts -> apps/web/src/courses/card.ts",
    "web-imports-server-types-only: apps/web/src/server-value.ts -> packages/server/src/index.ts",
    "web-library-below-features: apps/web/src/library/uses-feature.ts -> apps/web/src/courses/card.ts",
    "web-llm-mounted-only: apps/web/src/lesson/uses-llm.ts -> apps/web/src/llm/tutor.ts",
    "web-ui-presentational: apps/web/src/ui/uses-api.ts -> apps/web/src/api/hooks.ts",
    "web-ui-presentational: apps/web/src/ui/uses-library.ts -> apps/web/src/library/shell.ts",
  ]);
});
