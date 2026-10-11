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
    {
      name: "engine-folders-one-way",
      comment:
        "The engine's folders depend one way: learner/ (study days, progress) reads srs/ (the day's card answers), never the reverse — no cycle between folders, which no-circular sees only between files.",
      severity: "error",
      from: { path: "^packages/engine/src/srs/" },
      to: { path: "^packages/engine/src/learner/" },
    },
    onlyMayImport("course-kit-imports-schema-only", "^packages/course-kit/", [
      "packages/course-kit",
      "packages/schema",
    ]),
    {
      name: "course-kit-never-imports-courses",
      comment:
        "Course packages depend on course-kit; course-kit — its tests too — never imports one (its tests build their own library).",
      severity: "error",
      from: { path: "^packages/course-kit/" },
      to: { path: "^courses/" },
    },
    onlyMayImport("llm-imports-schema-only", "^packages/llm/", ["packages/llm", "packages/schema"]),
    onlyMayImport("anki-export-imports-schema-only", "^packages/anki-export/", [
      "packages/anki-export",
      "packages/schema",
    ]),
    {
      name: "courses-import-schema-and-course-kit",
      comment:
        "A provider imports its own folder, the shared rules, schema and course-kit; never another provider.",
      severity: "error",
      from: { path: "^courses/([^/]+)/", pathNot: "\\.test\\.tsx?$" },
      to: {
        path: "^(packages|courses|apps)/",
        pathNot: "^(courses/$1|courses/_shared|packages/schema|packages/course-kit)/",
      },
    },
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
      comment:
        "schema and engine run in the browser too, llm uses web-standard APIs only, anki-export takes SQLite and zstd from the caller: no Node/Bun built-ins in their sources.",
      severity: "error",
      from: { path: "^packages/(schema|engine|llm|anki-export)/src/", pathNot: "\\.test\\.tsx?$" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "web-llm-mounted-only",
      comment:
        "apps/web/src/llm is optional: only its mount points (the router, the runs it loads and the settings page) import it.",
      severity: "error",
      from: {
        path: "^apps/web/src/",
        pathNot:
          "^apps/web/src/(llm/|routes/router\\.tsx$|routes/runs\\.tsx$|routes/settings\\.tsx$)",
      },
      to: { path: "^apps/web/src/llm/" },
    },
    {
      name: "server-tables-through-stores",
      comment:
        "The profile's tables are reached through their stores: runs and events through services/run-store.ts, cards through services/card-store.ts; settings, keys and model routes through their own services. Nothing else imports the table definitions.",
      severity: "error",
      from: {
        path: "^packages/server/src/",
        pathNot:
          "^packages/server/src/(db/|runtime/|services/(run-store|card-store|settings|llm)\\.ts$)",
      },
      to: { path: "^packages/server/src/db/profile/schema\\.ts$" },
    },
    {
      name: "server-notebook-gathers",
      comment:
        "The Notebook gathers every module's standing through one contract (schema stats.ts), handed in by services/index.ts: of the server it reads only the run store (the study days) and errors — no module's service, nor content.",
      severity: "error",
      from: { path: "^packages/server/src/services/notebook\\.ts$" },
      to: {
        path: "^packages/server/src/",
        pathNot: "^packages/server/src/(services/run-store|errors)\\.ts$",
      },
    },
    ...[
      // Each learning module's services (a module and its declared sub-services); what they share —
      // the stores, content, settings, the model, lesson-context, in-flight — is no module's.
      [
        "lessons",
        "lessons|lesson-journal|mistakes|explain|understanding|writing|speaking|tutor|tutor-tools|courses-context|scene",
      ],
      ["exams", "exams|exam-runs|exam-rating|exam-conversation"],
      ["review", "study|words|cards|examples|decks|deck-audio"],
    ].map(([module, files], _, all) => ({
      name: `server-${module}-apart`,
      comment:
        "Learning modules (lessons, exams, review) connect only through the common connectors — the run store, the stats contract, what services/index.ts hands in — never by importing another module's services, nor the Notebook or progress, which gather them.",
      severity: "error",
      from: { path: `^packages/server/src/services/(${files})\\.ts$` },
      to: {
        path: `^packages/server/src/services/(${[
          ...all.filter(([m]) => m !== module).map(([, f]) => f),
          "notebook|progress",
        ].join("|")})\\.ts$`,
      },
    })),
    {
      name: "web-ui-presentational",
      comment:
        "apps/web/src/ui holds presentational pieces: no API calls and no features; what needs data lives in app/ or a feature folder.",
      severity: "error",
      from: { path: "^apps/web/src/ui/" },
      to: {
        path: "^apps/web/src/(api|app|audio|courses|exams|exercises|lesson|library|llm|notebook|routes|study|word)/",
      },
    },
    {
      name: "web-features-apart",
      comment:
        "The web's feature folders (lesson, exams, study, courses, notebook) do not import each other: what they share lives in ui, api, library, exercises, audio or word. Study's session — Anki's reviewer — is shared on purpose: Review's and the lesson's Words step's.",
      severity: "error",
      from: { path: "^apps/web/src/(lesson|exams|study|courses|notebook)/" },
      to: {
        path: "^apps/web/src/(lesson|exams|study|courses|notebook)/",
        pathNot: ["^apps/web/src/$1/", "^apps/web/src/study/session\\.tsx$"],
      },
    },
    {
      name: "web-api-below-features",
      comment:
        "apps/web/src/api is the client and its hooks: it imports no screen, feature or shared piece above it.",
      severity: "error",
      from: { path: "^apps/web/src/api/" },
      to: {
        path: "^apps/web/src/(app|audio|courses|exams|exercises|lesson|library|llm|notebook|routes|study|ui|word)/",
      },
    },
    {
      name: "web-library-below-features",
      comment:
        "apps/web/src/library holds what feature folders share: it imports none of them, nor the screens above them.",
      severity: "error",
      from: { path: "^apps/web/src/library/" },
      to: { path: "^apps/web/src/(app|courses|exams|lesson|llm|notebook|routes|study)/" },
    },
    {
      name: "server-app-reaches-course-kit-view-only",
      comment:
        "app.ts's graph is runtime-agnostic all the way down: of course-kit it imports only the node-free view (`@sprachanker/course-kit/view`; the barrel pulls node:fs in), and no course; types are erased, so type-only imports may name anything.",
      severity: "error",
      from: {
        path: "^packages/server/src/",
        pathNot: "^packages/server/src/(runtime/|index\\.ts$|config\\.ts$|providers\\.ts$)",
      },
      to: {
        path: "^(packages/course-kit/src/(?!library-view\\.ts$)|courses/)",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "server-io-in-runtime-only",
      comment:
        "app.ts and everything it imports stay runtime-agnostic (the web type-checks that graph): Node/Bun APIs only in src/runtime/ and the entry files that wire it (index, config, providers).",
      severity: "error",
      from: {
        path: "^packages/server/src/",
        pathNot: "^packages/server/src/(runtime/|index\\.ts$|config\\.ts$|providers\\.ts$)",
      },
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
    // Only for apps/web's `@/…` import alias (vite.config.ts, tsconfig.json).
    webpackConfig: { fileName: ".dependency-cruiser.aliases.cjs" },
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};
