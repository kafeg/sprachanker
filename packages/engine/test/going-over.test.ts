// Going over mistakes (04, "AI practice in courses"): a mistake's wrong parts only — a gap of many
// with the words around it, never cut mid-word; a pair; a choice; an order; words written or said —,
// grouped by type, the commonest first; the new items set as items of their closed types and checked
// by the engine; where the learner is in a review.
import { describe, expect, test } from "bun:test";
import type { Exercise, MistakeItem, MistakesReview, TypedEvent } from "@sprachanker/schema";
import {
  checkMistakeItem,
  type MistakeToGoOver,
  mistakeGroups,
  mistakeItemExercise,
  reviewAt,
  reviewItems,
  slipOf,
  understandingMistakes,
  wrongParts,
} from "../src/index.ts";

const exercise = (type: string, items: unknown[]) =>
  ({
    key: "s.x/c/01-01/ex-01",
    type,
    fingerprint: "",
    newWords: [],
    ruleIds: [],
    items: items.map((it, i) => ({ key: `s.x/c/01-01/ex-01#${i + 1}`, ...(it as object) })),
  }) as unknown as Exercise;

const mistake = (ex: Exercise, answer: unknown, extra: Partial<MistakeToGoOver> = {}) => ({
  itemKey: `${ex.key}#1`,
  exercise: ex,
  index: 0,
  answer,
  ...extra,
});

/** A gap item of eight gaps, as DW's long ones are. */
const WG = exercise("gap_text", [
  {
    segments: [
      "In der WG ",
      { gap: "g1" },
      " Nina heute kochen. Paul ",
      { gap: "g2" },
      " einkaufen, und ich ",
      { gap: "g3" },
      " das Bad putzen. Wir ",
      { gap: "g4" },
      " alle helfen, sonst ",
      { gap: "g5" },
      " es Streit. Am Abend ",
      { gap: "g6" },
      " wir zusammen und ",
      { gap: "g7" },
      " einen Film. Das ",
      { gap: "g8" },
      " schön.",
    ],
    answer: Object.fromEntries(
      ["muss", "geht", "muss", "müssen", "gibt", "essen", "sehen", "ist"].map((w, i) => [
        `g${i + 1}`,
        { accepted: [w] },
      ]),
    ),
  },
]);

describe("wrong parts", () => {
  test("a gap of many: only the wrong ones, each with the words around it, the others filled right", () => {
    const answer = {
      g1: "musst",
      g2: "geht",
      g3: "muss",
      g4: "müssen",
      g5: "gibt",
      g6: "essen",
      g7: "sehen",
      g8: "war",
    };
    const parts = wrongParts(mistake(WG, answer), "de");
    expect(parts).toEqual([
      {
        itemKey: "s.x/c/01-01/ex-01#1",
        what: "ending",
        given: "musst",
        right: "muss",
        context: "In der WG [_] Nina heute kochen. Paul geht einkaufen, …",
      },
      {
        itemKey: "s.x/c/01-01/ex-01#1",
        what: "word",
        given: "war",
        right: "ist",
        context: "… zusammen und sehen einen Film. Das [_] schön.",
      },
    ]);
  });

  test("a slip: the spelling (accents, ß), an ending, another word", () => {
    expect(slipOf("heisse", "heiße")).toBe("spelling");
    expect(slipOf("Mädchen", "Madchen")).toBe("spelling");
    expect(slipOf("musst", "muss")).toBe("ending");
    expect(slipOf("den", "dem")).toBe("ending");
    expect(slipOf("schöne", "schönen")).toBe("ending");
    expect(slipOf("der", "die")).toBe("word");
    expect(slipOf("Tee", "Kaffee")).toBe("word");
    expect(slipOf("", "muss")).toBe("word");
  });

  test("a choice, an order, a pair, a dictation, an answer said aloud with the model's correction", () => {
    const choice = exercise("single_choice", [
      {
        prompt: "Wo ist Lena?",
        options: [
          { id: "a", text: "Im Café." },
          { id: "b", text: "Im Park." },
        ],
        answer: { optionIds: ["a"] },
      },
    ]);
    expect(wrongParts(mistake(choice, { optionId: "b" }), "de")).toEqual([
      expect.objectContaining({
        what: "choice",
        given: "Im Park.",
        right: "Im Café.",
        context: "Wo ist Lena?",
      }),
    ]);
    const order = exercise("order", [
      {
        parts: ["Ich", "trinke", "gern", "Tee."].map((text, i) => ({ id: "abcd"[i], text })),
        join: "space",
        answer: { sequence: ["a", "b", "c", "d"] },
      },
    ]);
    expect(wrongParts(mistake(order, { sequence: ["b", "a", "c", "d"] }), "de")).toEqual([
      expect.objectContaining({
        what: "order",
        given: "trinke Ich gern Tee.",
        right: "Ich trinke gern Tee.",
      }),
    ]);
    const match = exercise("match", [
      {
        left: [
          { id: "a", text: "die Tasse" },
          { id: "b", text: "der Löffel" },
        ],
        right: [
          { id: "a", text: "cup" },
          { id: "b", text: "spoon" },
        ],
        answer: {
          pairs: [
            ["a", "a"],
            ["b", "b"],
          ],
        },
      },
    ]);
    const crossed = {
      pairs: [
        ["a", "b"],
        ["b", "a"],
      ],
    };
    expect(wrongParts(mistake(match, crossed), "de").map((p) => [p.context, p.given])).toEqual([
      ["die Tasse", "spoon"],
      ["der Löffel", "cup"],
    ]);
    const dictation = exercise("dictation", [{ answer: { accepted: ["Ich heiße Lena."] } }]);
    expect(wrongParts(mistake(dictation, { text: "Ich heisse Lena." }), "de")).toEqual([
      expect.objectContaining({ what: "spelling", given: "Ich heisse Lena." }),
    ]);
    const said = exercise("speech_selfrate", [{ prompt: "Wie heißt du?" }]);
    expect(
      wrongParts(
        mistake(said, { transcript: "ich heiße Lena" }, { corrected: "Ich heiße Lena." }),
        "de",
      ),
    ).toEqual([expect.objectContaining({ what: "spoken", right: "Ich heiße Lena." })]);
    // Unchecked by the model, an answer said aloud is no mistake to go over.
    expect(wrongParts(mistake(said, { transcript: "ich heiße Lena" }), "de")).toEqual([]);
    // An answer that does not read as its type's: nothing.
    expect(wrongParts(mistake(order, { optionId: "a" }), "de")).toEqual([]);
  });
});

test("groups: by the type new items are set of and what went wrong, the commonest first, at most three", () => {
  const all = {
    g1: "musst",
    g2: "gehst",
    g3: "musst",
    g4: "müsst",
    g5: "gab",
    g6: "esse",
    g7: "sehe",
    g8: "war",
  };
  const choice = exercise("multi_choice", [
    {
      options: [
        { id: "a", text: "ja" },
        { id: "b", text: "nein" },
      ],
      answer: { optionIds: ["a"] },
    },
  ]);
  const groups = mistakeGroups([mistake(WG, all), mistake(choice, { optionIds: ["b"] })], "de");
  expect(groups.map((g) => [g.type, g.what, g.mistakes.length])).toEqual([
    ["gap_text", "ending", 6],
    ["gap_text", "word", 2],
    ["single_choice", "choice", 1],
  ]);
});

test("an Understanding question answered wrong is a mistake to go over, as the item of its kind", () => {
  const ev = (n: number, type: TypedEvent["type"], payload: unknown) =>
    ({ id: `E${n}`, runId: "R", ts: n, type, itemKey: null, payload }) as TypedEvent;
  const text = {
    kind: "reading",
    title: "t",
    situation: "",
    lines: [{ text: "Kaffee 2 Euro" }],
    glossary: [],
    questions: [
      {
        phase: "reading",
        question: "Was kostet der Kaffee?",
        options: ["2 Euro", "3 Euro"],
        answer: 0,
      },
    ],
  };
  const events = [
    ev(1, "llm_verdict", {
      task: "understanding",
      input: "",
      model: "m",
      latencyMs: 1,
      result: text,
    }),
    ev(2, "practice_answered", {
      verdict: "E1",
      question: 0,
      answer: { optionId: "b" },
      outcome: { result: "wrong", score: 0 },
    }),
  ];
  const [m] = understandingMistakes(events);
  expect(m?.itemKey).toBe("E1#1");
  expect(wrongParts(m as MistakeToGoOver, "de")).toEqual([
    {
      itemKey: "E1#1",
      what: "choice",
      given: "3 Euro",
      right: "2 Euro",
      context: "Was kostet der Kaffee?",
    },
  ]);
});

describe("new items", () => {
  test.each([
    [
      "single_choice",
      { prompt: "Wer ___?", options: ["muss", "musst"], answer: 0 },
      { optionId: "a" },
      { optionId: "b" },
    ],
    [
      "gap_text",
      {
        text: "Ich ___ heute kochen, du ___ helfen.",
        gaps: [{ accepted: ["muss"] }, { accepted: ["musst"] }],
      },
      { g1: "muss", g2: "musst" },
      { g1: "musst", g2: "musst" },
    ],
    [
      "gap_choice",
      { text: "___ bin Anna.", gaps: [{ options: ["Ich", "Du"], answer: 0 }] },
      { g1: "a" },
      { g1: "b" },
    ],
    [
      "order",
      { parts: ["Ich", "trinke", "gern", "Tee."] },
      { sequence: ["a", "b", "c", "d"] },
      { sequence: ["b", "a", "c", "d"] },
    ],
    [
      "match",
      {
        pairs: [
          { left: "die Tasse", right: "cup" },
          { left: "der Löffel", right: "spoon" },
          { left: "das Glas", right: "glass" },
        ],
      },
      {
        pairs: [
          ["a", "a"],
          ["b", "b"],
          ["c", "c"],
        ],
      },
      {
        pairs: [
          ["a", "b"],
          ["b", "a"],
          ["c", "c"],
        ],
      },
    ],
  ] as const)("%s: an item of its type, checked by the engine", (type, item, right, wrong) => {
    const m = item as unknown as MistakeItem;
    expect(mistakeItemExercise(type, m, "k").type).toBe(type);
    expect(checkMistakeItem(type, m, right, "de").result).toBe("correct");
    expect(checkMistakeItem(type, m, wrong, "de").result).not.toBe("correct");
  });

  test("a gap at the start of a text; the gaps numbered in order", () => {
    const ex = mistakeItemExercise("gap_text", {
      text: "___ heiße Lena.",
      gaps: [{ accepted: ["Ich"] }],
    });
    expect((ex.items[0] as { segments: unknown[] }).segments).toEqual([
      { gap: "g1" },
      " heiße Lena.",
    ]);
  });

  test("a review: its items numbered across its groups, one group at a time", () => {
    const group = (n: number) => ({
      type: "single_choice" as const,
      what: "choice" as const,
      mistakes: [{ itemKey: "k", what: "choice" as const, given: "b", right: "a" }],
      explanation: "…",
      items: Array.from({ length: n }, () => ({ prompt: "?", options: ["a", "b"], answer: 0 })),
    });
    const review: MistakesReview = { groups: [group(2), group(3)] };
    expect(reviewItems(review).map((x) => [x.group, x.n])).toEqual([
      [0, 0],
      [0, 1],
      [1, 2],
      [1, 3],
      [1, 4],
    ]);
    expect(reviewAt(review, () => false)).toBe(0);
    expect(reviewAt(review, (n) => n < 2)).toBe(1);
    expect(reviewAt(review, () => true)).toBe(2);
  });
});
