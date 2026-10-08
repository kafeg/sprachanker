import { describe, expect, test } from "bun:test";
import { Manifest, RulesRegistry } from "../src/index.ts";

const hash = "ab".repeat(32);

describe("manifest", () => {
  const manifest = {
    format: 1,
    series: "dw.nicos-weg",
    provider: "dw-nicos-weg",
    providerVersion: "0.3.0",
    title: "Nicos Weg",
    licence: {
      id: "proprietary-personal-use",
      attribution: "Deutsche Welle",
      url: "https://learngerman.dw.com/",
    },
    courses: [
      {
        id: "a1",
        kind: "course",
        level: "A1",
        target: "de",
        editions: [
          { id: "ru-de", source: "ru", fetchedAt: "2026-10-05T10:00:00Z", contentVersion: hash },
        ],
      },
    ],
    files: {
      "canonical/a1/lessons/00-01.json": { sha256: hash, size: 12345 },
      "media/video/E1_sd.mp4": { sha256: hash, size: 7340032, mime: "video/mp4" },
    },
  };

  test("the example of spec 02 is valid", () => {
    expect(Manifest.parse(manifest)).toEqual(manifest as never);
  });

  test.each(["../escape.json", "/abs.json", "a/./b.json", "a/../b.json"])(
    "file path %s is rejected",
    (path) => {
      const bad = { ...manifest, files: { [path]: { sha256: hash, size: 1 } } };
      expect(Manifest.safeParse(bad).success).toBe(false);
    },
  );

  test("a newer format is rejected", () => {
    expect(Manifest.safeParse({ ...manifest, format: 2 }).success).toBe(false);
  });
});

describe("rules registry", () => {
  const rule = {
    id: "de.greeting.du-sie",
    title: { en: "Informal and formal address", ru: "«Ты» и «Вы»" },
    explanation: { ru: "…" },
    examples: ["Wie geht es dir?", "Wie geht es Ihnen?"],
  };

  test("valid registry", () => {
    expect(RulesRegistry.parse([rule])).toHaveLength(1);
  });

  test("duplicate ids fail", () => {
    const result = RulesRegistry.safeParse([rule, rule]);
    expect(result.error?.issues[0]?.message).toBe("duplicate rule id de.greeting.du-sie");
  });
});

test("a preference reads as set, else its default; one without a default stays unset", async () => {
  const { settingOf, SETTING_DEFAULTS, LEARNER_SETTINGS } = await import("../src/settings.ts");
  expect(settingOf({}, "speech.recognition")).toBe(true);
  expect(settingOf({ "speech.recognition": false }, "speech.recognition")).toBe(false);
  expect(settingOf(undefined, "theme")).toBe("system");
  expect(settingOf({}, "learner.target")).toBeUndefined();
  // Every default fits its key's schema.
  for (const [key, value] of Object.entries(SETTING_DEFAULTS))
    expect(LEARNER_SETTINGS[key as keyof typeof LEARNER_SETTINGS].safeParse(value).success).toBe(
      true,
    );
});
