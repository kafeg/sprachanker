import { describe, expect, test } from "bun:test";
import type { Exercise } from "@sprachanker/schema";
import { checkItem } from "../src/index.ts";

const ex = (type: string, item: Record<string, unknown>, ruleIds: string[] = []) =>
  ({
    key: "x.y/a1/00-01/ex-01",
    type,
    fingerprint: "0".repeat(64),
    newWords: [],
    ruleIds,
    items: [{ key: "x.y/a1/00-01/ex-01#1", ...item }],
  }) as unknown as Exercise;
const result = (e: Exercise, answer: unknown): [string, number] => {
  const o = checkItem(e, 0, answer, "de");
  return [o.result, Math.round(o.score * 100) / 100];
};

describe("single_choice", () => {
  const e = ex(
    "single_choice",
    {
      options: [
        { id: "a", text: "Hi!" },
        { id: "b", text: "Guten Tag." },
        { id: "c", text: "Guten Tag" },
      ],
      answer: { optionIds: ["b"] },
    },
    ["de.greeting.du-sie"],
  );
  test.each<[unknown, [string, number]]>([
    [{ optionId: "b" }, ["correct", 1]],
    [{ optionId: "a" }, ["wrong", 0]],
    [{ optionId: "c" }, ["correct", 1]],
  ])("%j", (answer, out) => expect(result(e, answer)).toEqual(out));
  test("carries rule ids", () =>
    expect(checkItem(e, 0, { optionId: "a" }, "de").ruleIds).toEqual([
      "de.greeting.du-sie",
    ] as never));
});

describe("multi_choice", () => {
  const e = ex("multi_choice", {
    options: [
      { id: "a", text: "1" },
      { id: "b", text: "2" },
      { id: "c", text: "3" },
      { id: "d", text: "4" },
    ],
    answer: { optionIds: ["a", "c"] },
  });
  test.each<[unknown, [string, number]]>([
    [
      ["a", "c"],
      ["correct", 1],
    ],
    [["a"], ["partial", 0.5]],
    [
      ["a", "b"],
      ["wrong", 0],
    ],
    [
      ["a", "c", "d"],
      ["partial", 0.5],
    ],
    [[], ["wrong", 0]],
  ])("%j", (ids, out) => expect(result(e, { optionIds: ids })).toEqual(out));
});

describe("match", () => {
  const e = ex("match", {
    left: [
      { id: "a", text: "ich" },
      { id: "b", text: "du" },
      { id: "c", text: "er" },
    ],
    right: [
      { id: "a", text: "esse" },
      { id: "b", text: "isst" },
      { id: "c", text: "isst" },
    ],
    answer: {
      pairs: [
        ["a", "a"],
        ["b", "b"],
        ["c", "c"],
      ],
    },
  });
  test("identical right sides are interchangeable", () =>
    expect(
      result(e, {
        pairs: [
          ["a", "a"],
          ["b", "c"],
          ["c", "b"],
        ],
      }),
    ).toEqual(["correct", 1]));
  test("a wrong pair fails the item", () =>
    expect(
      result(e, {
        pairs: [
          ["a", "b"],
          ["b", "a"],
          ["c", "c"],
        ],
      }),
    ).toEqual(["wrong", 0]));
});

describe("order", () => {
  const e = ex("order", {
    parts: [
      { id: "a", text: "T" },
      { id: "b", text: "a" },
      { id: "c", text: "s" },
      { id: "d", text: "s" },
      { id: "e", text: "e" },
    ],
    join: "none",
    answer: { sequence: ["a", "b", "c", "d", "e"] },
  });
  test.each<[unknown, [string, number]]>([
    [
      ["a", "b", "c", "d", "e"],
      ["correct", 1],
    ],
    [
      ["a", "b", "d", "c", "e"],
      ["correct", 1],
    ],
    [
      ["a", "b", "e", "c", "d"],
      ["partial", 0.4],
    ],
    [
      ["e", "a", "b", "c", "d"],
      ["wrong", 0],
    ],
  ])("%j", (sequence, out) => expect(result(e, { sequence })).toEqual(out));
});

describe("gap_choice", () => {
  const bank = [
    { id: "a", text: "heiße" },
    { id: "b", text: "komme" },
    { id: "c", text: "komme" },
  ];
  const e = ex("gap_choice", {
    segments: ["Ich ", { gap: "g1" }, " Lena, ich ", { gap: "g2" }, " aus Wien."],
    gaps: { g1: { options: bank }, g2: { options: bank } },
    display: "bank",
    answer: { g1: "a", g2: "b" },
  });
  test.each<[unknown, [string, number]]>([
    [{ g1: "a", g2: "b" }, ["correct", 1]],
    [{ g1: "a", g2: "c" }, ["correct", 1]],
    [{ g1: "b", g2: "a" }, ["wrong", 0]],
    [{ g1: "a" }, ["wrong", 0]],
  ])("%j", (answer, out) => expect(result(e, answer)).toEqual(out));
});

describe("gap_text", () => {
  const e = ex("gap_text", {
    segments: ["Einen ", { gap: "g1" }, ", bitte."],
    answer: { g1: { accepted: ["Kaffee", "Tee"] } },
  });
  test.each<[unknown, [string, number]]>([
    [{ g1: "Kaffee" }, ["correct", 1]],
    [{ g1: " Tee " }, ["correct", 1]],
    [{ g1: "kaffee" }, ["correct", 1]],
    [{ g1: "Kakao" }, ["wrong", 0]],
  ])("%j", (answer, out) => expect(result(e, answer)).toEqual(out));
});

describe("dictation", () => {
  const e = ex("dictation", {
    media: { audio: "media/audio/x.mp3" },
    answer: { accepted: ["Es geht mir sehr gut, danke."] },
  });
  test.each<[unknown, [string, number]]>([
    ["Es geht mir sehr gut, danke.", ["correct", 1]],
    ["es geht mir sehr gut, danke", ["correct", 1]],
    ["Es geht mir sehr gut danke", ["correct", 1]],
    ["Es geht mir gut, danke", ["partial", 0.83]],
    ["Mir geht es gut", ["wrong", 0.33]],
  ])("%s", (text, out) => expect(result(e, { text })).toEqual(out));
  test("diff is returned", () =>
    expect(
      checkItem(e, 0, { text: "Es geht mir gut, danke" }, "de").diff?.some(
        (d) => d.op === "missing",
      ),
    ).toBe(true));
});

describe("speech and open answers", () => {
  test("speech_repeat ignores case", () => {
    const e = ex("speech_repeat", { text: "Wie geht es Ihnen?" });
    expect(result(e, { speech: { recording: "r1", transcript: "wie geht es ihnen" } })).toEqual([
      "correct",
      1,
    ]);
  });
  test("selfrate is unscored", () =>
    expect(result(ex("speech_selfrate", { text: "Hallo!" }), { rating: "good" })).toEqual([
      "unscored",
      0,
    ]));
  test("respond: rubric first, LLM verdict pending", () => {
    const e = ex("respond", {
      input: "text",
      rubric: { required: [{ id: "drink", anyOf: ["Kaffee", "Tee"] }], criteria: [] },
      reference: ["Einen Kaffee, bitte."],
    });
    const o = checkItem(e, 0, { text: "Ich möchte einen Tee." }, "de");
    expect([o.result, o.needsLlm]).toEqual(["correct", true]);
    expect(
      checkItem(ex("respond", { input: "text", reference: ["x"] }), 0, { text: "y" }, "de").result,
    ).toBe("unscored");
  });
  test("an answer of the wrong shape throws", () =>
    expect(() =>
      checkItem(
        ex("dictation", { media: { audio: "media/audio/x.mp3" }, answer: { accepted: ["a"] } }),
        0,
        { optionId: "a" },
        "de",
      ),
    ).toThrow());
});
