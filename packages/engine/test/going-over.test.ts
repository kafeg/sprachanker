// Going over mistakes (04, "AI practice in courses"): a mistake's wrong parts only — a gap of many
// with the words around it, never cut mid-word; a pair; a choice; an order; words written or said —,
// grouped by type, the commonest first; the new items set as items of their closed types and checked
// by the engine; where the learner is in a review.
import { describe, expect, test } from "bun:test";
import type {
  Exercise,
  Lesson,
  MistakeItem,
  MistakesReview,
  TypedEvent,
} from "@sprachanker/schema";
import {
  checkMistakeItem,
  hasMistakesToGoOver,
  type MistakeToGoOver,
  mistakeGroups,
  mistakeItemExercise,
  mistakesToGoOver,
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

/** WG's gaps all filled right. */
const RIGHT = Object.fromEntries(
  ["muss", "geht", "muss", "müssen", "gibt", "essen", "sehen", "ist"].map((w, i) => [
    `g${i + 1}`,
    w,
  ]),
);

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

  test("a slip: the spelling (the language's own: German's ß; a letter off), an ending, another word", () => {
    expect(slipOf("heisse", "heiße", "de")).toBe("spelling");
    expect(slipOf("Wonhung", "Wohnung", "de")).toBe("spelling");
    expect(slipOf("Ziet", "Zeit", "de")).toBe("spelling");
    expect(slipOf("Schwetser", "Schwester", "de")).toBe("spelling");
    expect(slipOf("musst", "muss", "de")).toBe("ending");
    expect(slipOf("den", "dem", "de")).toBe("ending");
    expect(slipOf("schöne", "schönen", "de")).toBe("ending");
    expect(slipOf("der", "die", "de")).toBe("word");
    expect(slipOf("Tee", "Kaffee", "de")).toBe("word");
    expect(slipOf("", "muss", "de")).toBe("word");
    // ß is German's: elsewhere ss is another spelling only by its letters.
    expect(slipOf("strasse", "straße", "fr")).not.toBe("spelling");
    expect(slipOf("gross", "groß", "en")).not.toBe("spelling");
  });

  test("a difference only in accents or umlauts is another word, never a slip", () => {
    expect(slipOf("Mutter", "Mütter", "de")).toBe("word");
    expect(slipOf("wurde", "würde", "de")).toBe("word");
    expect(slipOf("schon", "schön", "de")).toBe("word");
    expect(slipOf("Madchen", "Mädchen", "de")).toBe("word");
    expect(slipOf("si", "sí", "es")).toBe("word");
  });

  test("case by the language learnt (Turkish I is ı): a word in the wrong case is its spelling", () => {
    expect(slipOf("haus", "Haus", "de")).toBe("spelling");
    expect(slipOf("KAPI", "kapı", "tr")).toBe("spelling");
    expect(slipOf("İSTANBUL", "istanbul", "tr")).toBe("spelling");
    // Lower-cased as English, I is i: "kapi", another ending of "kapı".
    expect(slipOf("KAPI", "kapı", "en")).toBe("ending");
  });

  test("a choice, an order, a pair", () => {
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
  const { groups } = mistakeGroups([mistake(WG, all), mistake(choice, { optionIds: ["b"] })], "de");
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
  // Misread: the question, the answers, the line of the text the right one is in.
  expect(wrongParts(m as MistakeToGoOver, "de")).toEqual([
    {
      itemKey: "E1#1",
      what: "misread",
      given: "3 Euro",
      right: "2 Euro",
      context: "Was kostet der Kaffee?",
      line: "Kaffee 2 Euro",
    },
  ]);
  // Listed only, in one group last ("comprehension"): no new items are set of it.
  const oneWrong = { ...RIGHT, g1: "musst" };
  const { groups } = mistakeGroups([m as MistakeToGoOver, mistake(WG, oneWrong)], "de");
  expect(groups.map((g) => [g.type, g.what])).toEqual([
    ["gap_text", "ending"],
    [undefined, "comprehension"],
  ]);
  // A question heard: misheard; a true/false one names no line.
  const heard = {
    ...text,
    kind: "dialogue",
    lines: [{ speaker: "A", text: "Der Zug kommt um acht." }],
    questions: [
      {
        phase: "listening",
        question: "Der Zug kommt um neun.",
        options: ["Richtig", "Falsch"],
        answer: 1,
      },
    ],
  };
  const [h] = understandingMistakes([
    ev(1, "llm_verdict", {
      task: "understanding",
      input: "",
      model: "m",
      latencyMs: 1,
      result: heard,
    }),
    ev(2, "practice_answered", {
      verdict: "E1",
      question: 0,
      answer: { optionId: "a" },
      outcome: { result: "wrong", score: 0 },
    }),
  ]);
  const [p] = wrongParts(h as MistakeToGoOver, "de");
  expect(p).toEqual(
    expect.objectContaining({ what: "misheard", given: "Richtig", right: "Falsch" }),
  );
  expect(p?.line).toBeUndefined();
});

describe("what a mistake shows and what it is set as", () => {
  test("a dictation: each word written wrong, with the words around it", () => {
    const dictation = exercise("dictation", [
      { answer: { accepted: ["Ich heiße Lena und wohne in Berlin."] } },
    ]);
    const parts = wrongParts(
      mistake(dictation, { text: "Ich heisse Lena und wohnen in Berlin." }),
      "de",
    );
    expect(parts.map((p) => [p.what, p.given, p.right, p.context])).toEqual([
      ["spelling", "heisse", "heiße", "Ich [_] Lena und wohne in Berlin"],
      ["ending", "wohnen", "wohne", "Ich heiße Lena und [_] in Berlin"],
    ]);
    const { groups } = mistakeGroups(
      [mistake(dictation, { text: "Ich heisse Lena und wohnen in Berlin." })],
      "de",
    );
    expect(groups.map((g) => g.type)).toEqual(["gap_text", "gap_text"]);
  });

  test("said aloud: the words heard wrong, listed only — never typed-gap practice", () => {
    const repeat = exercise("speech_repeat", [{ text: "Ich wohne in Berlin." }]);
    const heard = { speech: { transcript: "ich wohne im berlin", recording: "r.webm" } };
    const parts = wrongParts(mistake(repeat, heard), "de");
    expect(parts.map((p) => [p.what, p.given, p.right])).toEqual([["spoken", "im", "in"]]);
    const said = exercise("speech_selfrate", [{ prompt: "Wie heißt du?" }]);
    const corrected = mistake(
      said,
      { transcript: "ich heiße Lena" },
      { corrected: "Ich heiße Lena." },
    );
    // Heard as the correction is (case and marks not heard): nothing wrong in it.
    expect(wrongParts(corrected, "de")).toEqual([]);
    const off = mistake(said, { transcript: "ich heißen Lena" }, { corrected: "Ich heiße Lena." });
    expect(wrongParts(off, "de")).toEqual([
      expect.objectContaining({ what: "spoken", given: "heißen", right: "heiße" }),
    ]);
    // Unchecked by the model, an answer said aloud is no mistake to go over.
    expect(wrongParts(mistake(said, { transcript: "ich heiße Lena" }), "de")).toEqual([]);
    const { groups } = mistakeGroups([mistake(repeat, heard), off], "de");
    expect(groups.map((g) => [g.type, g.what, g.mistakes.length])).toEqual([
      [undefined, "spoken", 2],
    ]);
  });

  test("letters put in order: the word's spelling, set as a gap typed", () => {
    const letters = exercise("order", [
      {
        prompt: "das Haus",
        parts: ["H", "a", "u", "s"].map((text, i) => ({ id: "abcd"[i], text })),
        join: "none",
        answer: { sequence: ["a", "b", "c", "d"] },
      },
    ]);
    const m = mistake(letters, { sequence: ["a", "c", "b", "d"] });
    expect(wrongParts(m, "de")).toEqual([
      expect.objectContaining({
        what: "spelling",
        given: "Huas",
        right: "Haus",
        context: "das Haus",
      }),
    ]);
    expect(mistakeGroups([m], "de").groups.map((g) => [g.type, g.what])).toEqual([
      ["gap_text", "spelling"],
    ]);
  });

  test("sentences put in order: only the places another sentence took", () => {
    const texts = [
      "Ich stehe auf.",
      "Ich frühstücke.",
      "Ich gehe zur Arbeit.",
      "Ich komme nach Hause.",
    ];
    const story = exercise("order", [
      {
        parts: texts.map((text, i) => ({ id: "abcd"[i], text })),
        join: "space",
        answer: { sequence: ["a", "b", "c", "d"] },
      },
    ]);
    const m = mistake(story, { sequence: ["b", "a", "c", "d"] });
    expect(wrongParts(m, "de").map((p) => [p.what, p.given, p.right])).toEqual([
      ["sentence_order", "Ich frühstücke.", "Ich stehe auf."],
      ["sentence_order", "Ich stehe auf.", "Ich frühstücke."],
    ]);
    expect(mistakeGroups([m], "de").groups.map((g) => [g.type, g.what])).toEqual([
      ["order", "sentence_order"],
    ]);
  });

  test("pictures: named by the edition's description, left out when nothing describes them", () => {
    const pictures = exercise("single_choice", [
      {
        prompt: "Was ist das?",
        options: [
          { id: "a", media: { image: "a.jpg" } },
          { id: "b", media: { image: "b.jpg" } },
        ],
        answer: { optionIds: ["a"] },
      },
    ]);
    expect(wrongParts(mistake(pictures, { optionId: "b" }), "de")).toEqual([]);
    const described = {
      sourceId: "x",
      items: { "#1": { alt: { a: "ein Hund", b: "eine Katze" } } },
    };
    expect(wrongParts(mistake(pictures, { optionId: "b" }, { locale: described }), "de")).toEqual([
      expect.objectContaining({ given: "eine Katze", right: "ein Hund" }),
    ]);
  });

  test("a choice without its own question: the edition's prompt, else the exercise's instruction", () => {
    const bare = exercise("single_choice", [
      {
        options: [
          { id: "a", text: "Guten Morgen" },
          { id: "b", text: "Gute Nacht" },
        ],
        answer: { optionIds: ["a"] },
      },
    ]);
    const prompted = { sourceId: "x", items: { "#1": { prompt: "It is 8 a.m." } } };
    expect(
      wrongParts(mistake(bare, { optionId: "b" }, { locale: prompted }), "de")[0]?.context,
    ).toBe("It is 8 a.m.");
    const instructed = {
      sourceId: "x",
      instructionHtml: "<p>Choose the <b>greeting</b>.</p>",
      items: {},
    };
    expect(
      wrongParts(mistake(bare, { optionId: "b" }, { locale: instructed }), "de")[0]?.context,
    ).toBe("Choose the greeting .");
  });

  test("more than three types of six: the parts left out counted", () => {
    const { groups, more } = mistakeGroups(
      [
        mistake(WG, {
          g1: "musst",
          g2: "gehst",
          g3: "musst",
          g4: "müsst",
          g5: "gab",
          g6: "esse",
          g7: "sehe",
          g8: "war",
        }),
      ],
      "de",
    );
    expect(groups.map((g) => g.mistakes.length)).toEqual([6, 2]);
    expect(more).toBe(0);
    const many = mistakeGroups(
      [mistake(WG, { g1: "a", g2: "b", g3: "c", g4: "d", g5: "e", g6: "f", g7: "g", g8: "h" })],
      "de",
    );
    expect(many.groups.map((g) => g.mistakes.length)).toEqual([6]);
    expect(many.more).toBe(2);
  });
});

test("a run's mistakes to go over: the lesson's exercises in its order, those gone from it left out, then Understanding's", () => {
  const second = { ...WG, key: "s.x/c/01-01/ex-02" } as Exercise;
  const lesson = {
    key: "s.x/c/01-01",
    pages: [{ exercise: WG }, { exercise: second }],
  } as unknown as Lesson;
  const ev = (n: number, itemKey: string, answer: unknown) =>
    ({
      id: `E${n}`,
      runId: "R",
      ts: n,
      type: "answered",
      itemKey,
      payload: { answer, attempt: 1, ms: 1, outcome: { result: "wrong", score: 0 } },
    }) as TypedEvent;
  const events = [
    ev(1, "s.x/c/01-01/ex-02#1", { g1: "musst" }),
    ev(2, "s.x/c/01-01/ex-01#1", { g1: "musst" }),
    ev(3, "s.x/c/01-01/ex-09#1", { g1: "musst" }),
  ];
  expect(mistakesToGoOver(events, lesson).map((m) => m.itemKey)).toEqual([
    "s.x/c/01-01/ex-01#1",
    "s.x/c/01-01/ex-02#1",
  ]);
  expect(hasMistakesToGoOver(events, lesson, null, "de")).toBe(true);
  expect(hasMistakesToGoOver([events[2] as TypedEvent], lesson, null, "de")).toBe(false);
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

test("grammar chosen before the options picked, however common those are", () => {
  const choice = exercise("single_choice", [
    {
      prompt: "Was dreht das Team?",
      options: [
        { id: "a", text: "eine Serie" },
        { id: "b", text: "einen Film" },
      ],
      answer: { optionIds: ["a"] },
    },
  ]);
  const order = exercise("order", [
    {
      parts: ["Ich", "trinke", "gern", "Tee."].map((text, i) => ({ id: "abcd"[i], text })),
      join: "space",
      answer: { sequence: ["a", "b", "c", "d"] },
    },
  ]);
  const chose = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      ...mistake(choice, { optionId: "b" }),
      itemKey: `c#${i}`,
    }));
  const { groups, more } = mistakeGroups(
    [
      ...chose(4),
      mistake(order, { sequence: ["b", "a", "c", "d"] }),
      mistake(WG, { ...RIGHT, g1: "musst", g8: "war" }),
    ],
    "de",
  );
  expect(groups.map((g) => g.what)).toEqual(["order", "ending", "word"]);
  expect(more).toBe(4);
});
