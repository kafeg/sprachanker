import { describe, expect, test } from "bun:test";
import { missingEntries } from "./check.ts";
import { ANDROID, ANDROID_DECLARED, type Component, NATIVE, RUNTIME } from "./inventory.ts";
import { chosen, linkedCrates, lockPackages, render } from "./notices.ts";

const inventory = [...NATIVE, ...RUNTIME, ...ANDROID];

describe("the inventory", () => {
  test("names every engine, Bun, ONNX Runtime, Android library and Piper voice the builds ship", () => {
    expect(missingEntries(inventory, ANDROID_DECLARED)).toEqual([]);
  });

  test("a shipped engine without an entry fails", () => {
    const withoutSherpa = inventory.filter((c) => c.engine !== "piper");
    expect(missingEntries(withoutSherpa, ANDROID_DECLARED)).toEqual([
      "sherpa-onnx-offline-tts (native/piper) has no entry",
    ]);
  });

  test("an engine pinned elsewhere than its VERSION fails", () => {
    const moved = inventory.map((c) => (c.engine === "whisper" ? { ...c, version: "v0.0.1" } : c));
    expect(missingEntries(moved, ANDROID_DECLARED)[0]).toContain("native/whisper/VERSION");
  });

  test("an Android library the Gradle build declares without an entry fails", () => {
    expect(missingEntries(inventory, ANDROID_DECLARED.slice(1))).toEqual([
      `Android library ${ANDROID_DECLARED[0]} has no entry`,
    ]);
  });
});

describe("choosing among licences", () => {
  test("MIT where offered, else Apache-2.0, else the first; AND kept whole", () => {
    expect(chosen("MIT OR Apache-2.0")).toBe("MIT");
    expect(chosen("Apache-2.0/MIT")).toBe("MIT");
    expect(chosen("Zlib OR Apache-2.0")).toBe("Apache-2.0");
    expect(chosen("Unlicense OR 0BSD")).toBe("Unlicense");
    expect(chosen("(MIT OR Apache-2.0) AND Unicode-3.0")).toBe(
      "(MIT OR Apache-2.0) AND Unicode-3.0",
    );
  });
});

describe("the JavaScript packages shipped", () => {
  const lock = {
    workspaces: {
      "apps/web": { dependencies: { a: "1", "@s/lib": "workspace:*" } },
      "apps/cli": {},
      "apps/mobile": {},
      "packages/lib": { dependencies: { b: "1" } },
      "apps/dev": { dependencies: { tool: "1" } },
    },
    packages: {
      a: ["a@1.0.0", "", { dependencies: { c: "^2" } }, ""],
      "a/c": ["c@2.0.0", "", {}, ""],
      c: ["c@1.0.0", "", {}, ""],
      b: ["b@1.0.0", "", { dependencies: { c: "^1" } }, ""],
      "@s/lib": ["@s/lib@workspace:packages/lib"],
      tool: ["tool@1.0.0", "", {}, ""],
    },
  } as unknown as Parameters<typeof lockPackages>[0];

  test("follows dependencies through workspaces, a nested copy before the top one", () => {
    expect(lockPackages(lock)).toEqual(["a@1.0.0", "b@1.0.0", "c@1.0.0", "c@2.0.0"]);
  });
});

describe("the Rust crates linked", () => {
  test("normal dependencies only, not build ones or procedural macros", () => {
    const pkg = (id: string, kind = "lib") => ({
      id,
      name: id,
      version: "1.0.0",
      license: "MIT",
      license_file: null,
      authors: [],
      manifest_path: `/x/${id}/Cargo.toml`,
      links: null,
      source: null,
      targets: [{ kind: [kind] }],
    });
    const dep = (id: string, kind: string | null = null) => ({ pkg: id, dep_kinds: [{ kind }] });
    const crates = linkedCrates({
      packages: [pkg("app"), pkg("serde"), pkg("derive", "proc-macro"), pkg("syn"), pkg("cc")],
      workspace_members: ["app"],
      resolve: {
        nodes: [
          { id: "app", deps: [dep("serde"), dep("derive"), dep("cc", "build")] },
          { id: "serde", deps: [] },
          { id: "derive", deps: [dep("syn")] },
          { id: "syn", deps: [] },
          { id: "cc", deps: [] },
        ],
      },
    });
    expect(crates.map((c) => c.id)).toEqual(["serde"]);
  });
});

describe("the notices file", () => {
  const c = (name: string, texts: string[], group: Component["group"] = "js"): Component => ({
    group,
    name,
    version: "1.0.0",
    licence: "MIT",
    source: `https://example.org/${name}`,
    builds: ["program", "android"],
    texts,
  });
  const components = [
    c("zeta", ["MIT text\r\n"]),
    c("alpha", ["MIT text"]),
    c("engine", ["GPL text", "MIT text"], "native"),
  ];

  test("is the same whatever order the components come in", () => {
    expect(render(components)).toBe(render([...components].reverse()));
  });

  test("lists engines first, then by name, each text once", () => {
    const file = render(components);
    expect(file.indexOf("engine 1.0.0")).toBeLessThan(file.indexOf("alpha 1.0.0"));
    expect(file.indexOf("alpha 1.0.0")).toBeLessThan(file.indexOf("zeta 1.0.0"));
    expect(file.match(/^MIT text$/gm)).toHaveLength(1);
    expect(file).toContain("  In: program, Android app\n");
    expect(file).toContain("Licence text: [1] [2]");
  });
});
