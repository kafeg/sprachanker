import { describe, expect, test } from "bun:test";
import { Lesson, LibraryPath, RulesRegistry } from "../src/index.ts";

const hash = "ab".repeat(32);

test.each(["../escape.json", "/abs.json", "a/./b.json", "a/../b.json"])(
  "library path %s is rejected",
  (path) => {
    expect(LibraryPath.safeParse(path).success).toBe(false);
  },
);

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
  expect(settingOf({}, "exam.federalState")).toBeUndefined();
  // Every default fits its key's schema.
  for (const [key, value] of Object.entries(SETTING_DEFAULTS))
    expect(LEARNER_SETTINGS[key as keyof typeof LEARNER_SETTINGS].safeParse(value).success).toBe(
      true,
    );
});

describe("lesson", () => {
  const key = "dw.nicos-weg/a1-ru/00-01";
  const exercise = {
    key: `${key}/ex-01`,
    type: "speech_repeat",
    fingerprint: hash,
    newWords: [],
    ruleIds: [],
    items: [{ key: `${key}/ex-01#1`, text: "Hallo" }],
  };
  const lesson = {
    format: 1,
    key,
    unit: "dw.nicos-weg/a1-ru/u00",
    media: {},
    goals: [],
    pages: [{ exercise }],
    vocab: [],
    unmapped: [],
  };

  test("valid lesson", () => {
    expect(Lesson.safeParse(lesson).error).toBeUndefined();
  });

  test("a field the format does not know is an error, not dropped", () => {
    expect(Lesson.safeParse({ ...lesson, titel: "x" }).success).toBe(false);
    const misspelt = { ...exercise, instrucion: "x" };
    expect(Lesson.safeParse({ ...lesson, pages: [{ exercise: misspelt }] }).success).toBe(false);
  });

  test("an exercise key met twice, or not of the lesson, fails", () => {
    const twice = Lesson.safeParse({ ...lesson, pages: [{ exercise }, { exercise }] });
    expect(twice.error?.issues.map((i) => i.message)).toContain(
      `exercise key ${exercise.key} met twice`,
    );
    const other = "dw.nicos-weg/a1-ru/00-02/ex-01";
    const elsewhere = { ...exercise, key: other, items: [{ key: `${other}#1`, text: "Hallo" }] };
    expect(
      Lesson.safeParse({ ...lesson, pages: [{ exercise: elsewhere }] }).error?.issues.map(
        (i) => i.message,
      ),
    ).toEqual([`exercise key ${other} not of lesson ${key}`]);
  });
});
