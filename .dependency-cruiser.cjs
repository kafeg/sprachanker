// Module boundaries from the root CLAUDE.md ("Dependency rules").
// scripts/boundaries.test.ts runs these rules against scripts/fixtures/boundaries to prove they fire.

/** Forbid `from` importing any module source except the allowed ones. */
const onlyMayImport = (name, from, allowed) => ({
  name,
  severity: "error",
  from: { path: from, pathNot: "\\.test\\.tsx?$" },
  to: { path: "^(packages|courses|apps)/", pathNot: `^(${allowed.join("|")})/` },
});

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
    { name: "not-to-unresolvable", severity: "error", from: {}, to: { couldNotResolve: true } },
    {
      name: "no-non-package-json",
      severity: "error",
      from: {},
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"] },
    },
    {
      name: "nothing-imports-apps",
      comment: "Nothing imports from apps/*; an app may import only its own files.",
      severity: "error",
      from: { path: "^(?!apps/)" },
      to: { path: "^apps/" },
    },
    {
      name: "app-imports-other-app",
      severity: "error",
      from: { path: "^apps/([^/]+)/" },
      to: { path: "^apps/", pathNot: "^apps/$1/" },
    },
    onlyMayImport("schema-imports-nothing", "^packages/schema/", ["packages/schema"]),
    onlyMayImport("engine-imports-schema-only", "^packages/engine/", [
      "packages/engine",
      "packages/schema",
    ]),
    onlyMayImport("course-kit-imports-schema-only", "^packages/course-kit/", [
      "packages/course-kit",
      "packages/schema",
    ]),
    onlyMayImport("llm-imports-schema-only", "^packages/llm/", ["packages/llm", "packages/schema"]),
    onlyMayImport("anki-export-imports-schema-only", "^packages/anki-export/", [
      "packages/anki-export",
      "packages/schema",
    ]),
    onlyMayImport("courses-import-schema-and-course-kit", "^courses/", [
      "courses",
      "packages/schema",
      "packages/course-kit",
    ]),
    onlyMayImport("web-imports-schema-engine-server-types", "^apps/web/", [
      "apps/web",
      "packages/schema",
      "packages/engine",
      "packages/server",
    ]),
    {
      name: "web-imports-server-types-only",
      comment: "apps/web may import the server's AppType for the Hono RPC client, nothing else.",
      severity: "error",
      from: { path: "^apps/web/" },
      to: { path: "^packages/server/", dependencyTypesNot: ["type-only"] },
    },
    onlyMayImport("cli-imports-server-only", "^apps/cli/", ["apps/cli", "packages/server"]),
    {
      name: "pure-modules-no-io",
      comment: "schema and engine run in the browser too: no Node/Bun built-ins.",
      severity: "error",
      from: { path: "^packages/(schema|engine)/", pathNot: "\\.test\\.tsx?$" },
      to: { dependencyTypes: ["core"] },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)dist/|^scripts/fixtures/" },
    // swc parses TypeScript itself and marks type-only imports, so this tool does not depend on
    // the TypeScript compiler API or pin the TypeScript version.
    parser: "swc",
    builtInModules: { add: ["bun", "bun:test", "bun:sqlite", "bun:ffi", "bun:jsc"] },
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};
