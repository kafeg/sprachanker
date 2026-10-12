// mistake_items (04, "AI practice in courses"; 07): the groups as data — what went wrong, the new
// items' type and fields, each mistake its wrong part only —; the rules (what is wrong, never why; new
// items of the type, never a sentence again); every group answered once, each item valid for its type.
import { expect, test } from "bun:test";
import { mistakeLine, wrongPartLine } from "../src/tasks/describe.ts";
import {
  type MistakeItemsInput,
  type MistakeItemsReply,
  mistakeItemsCheckTask,
  mistakeItemsRules,
  mistakeItemsTask,
  settledItems,
} from "../src/tasks/mistake-items.ts";
import { GENDER_FREE } from "../src/tasks/rules.ts";

const input: MistakeItemsInput = {
  language: "ru",
  target: "de",
  lesson: {
    title: "In der WG",
    goals: [],
    grammarHtml: ["<p>Modalverben: ich muss, du musst</p>"],
    vocab: [{ target: "kochen", translation: "готовить" }],
    level: "A1",
  },
  groups: [
    {
      type: "gap_text",
      what: "ending",
      mistakes: [
        {
          itemKey: "k#1",
          what: "ending",
          given: "musst",
          right: "muss",
          context: "In der WG [_] Nina heute kochen.",
        },
      ],
    },
    {
      type: "single_choice",
      what: "choice",
      mistakes: [
        { itemKey: "k#2", what: "choice", given: "", right: "Im Café.", context: "Wo ist Lena?" },
      ],
    },
  ],
};

test("the groups as data: what went wrong, the new items' type and fields, the wrong parts only", () => {
  const { name, request } = mistakeItemsTask(input);
  expect(name).toBe("mistake_items");
  // Explanations and new items that teach keep a command-line agent's default effort.
  expect(request.effort).toBeUndefined();
  const [system, user] = request.messages.map((m) => String(m.content));
  for (const part of [
    "never guess why the learner chose it",
    'a tendency ("usually") is no rule',
    "never a sentence of the mistakes again",
    "each with exactly one right answer",
    "A gap typed always has its cue in brackets right after it",
    "Write only in Russian and German",
    "The learner's gender is unknown",
  ])
    expect(system).toContain(part);
  expect(system).not.toContain("A1");
  expect(system).toEndWith(
    `Reply with the JSON object only.\nWrite only in Russian and German: not a word in any other language.\n${GENDER_FREE.ru}`,
  );
  expect(user).toContain(
    'Group 1 — what went wrong: the ending or form of a word; new items: gap_text, with "text" (a sentence with each gap written ___',
  );
  expect(user).toContain('- learner "musst", correct "muss" in "In der WG [_] Nina heute kochen."');
  expect(user).toContain('- learner (no answer), correct "Im Café." to "Wo ist Lena?"');
  expect(user).toContain("Grammar notes of this lesson:\nModalverben: ich muss, du musst");
  expect(user).toEndWith("Remember: 2 groups; explanations in Russian, the items in German.");
  expect(mistakeItemsRules("ru", "de")).toContain("explanation");
});

test("every group answered once, each item valid for its group's type; else repaired", () => {
  const { check } = mistakeItemsTask(input);
  const gap = { text: "Er ___ (müssen) kochen.", gaps: [{ accepted: ["muss"] }] };
  const choice = { prompt: "Wo ist Tom?", options: ["Im Café.", "Im Park."], answer: 0 };
  // The model writes every field, null where the type has none (strict structured outputs).
  const full = (item: Record<string, unknown>) => ({
    ...Object.fromEntries(
      ["prompt", "options", "answer", "text", "gaps", "parts", "pairs"].map((k) => [k, null]),
    ),
    ...item,
    ...(Array.isArray(item.gaps) && {
      gaps: item.gaps.map((g) => ({ accepted: null, options: null, answer: null, ...g })),
    }),
  });
  type Group = { n: number; explanation: string; items: Array<Record<string, unknown>> };
  const reply = (groups: Group[]) =>
    check?.({
      groups: groups.map((g) => ({ ...g, items: g.items.map(full) })),
    } as unknown as MistakeItemsReply);
  expect(
    reply([
      { n: 1, explanation: "…", items: [gap, gap] },
      { n: 2, explanation: "…", items: [choice, choice] },
    ]),
  ).toBeUndefined();
  // A group missing, a gap item whose gaps do not match its text, a choice without its answer.
  expect(reply([{ n: 1, explanation: "…", items: [gap, gap] }])).toContain("group 2");
  expect(
    reply([
      {
        n: 1,
        explanation: "…",
        items: [gap, { text: "Er ___ und ___.", gaps: [{ accepted: ["a"] }] }],
      },
      { n: 2, explanation: "…", items: [choice, choice] },
    ]),
  ).toContain("group 1, item 2");
  expect(
    reply([
      { n: 1, explanation: "…", items: [gap, gap] },
      { n: 2, explanation: "…", items: [choice, { prompt: "?", options: ["a", "b"] }] },
    ]),
  ).toContain("group 2, item 2");
  const second = (item: Record<string, unknown>, n = 1) =>
    reply(
      n === 1
        ? [
            { n: 1, explanation: "…", items: [gap, item] },
            { n: 2, explanation: "…", items: [choice, choice] },
          ]
        : [
            { n: 1, explanation: "…", items: [gap, gap] },
            { n: 2, explanation: "…", items: [choice, item] },
          ],
    );
  // A typed gap needs its cue (else another right word is marked wrong); a prompt does too.
  expect(second({ text: "Er ___ kochen.", gaps: [{ accepted: ["muss"] }] })).toContain(
    "cue in brackets",
  );
  expect(
    second({ prompt: "Mit «müssen»:", text: "Er ___ kochen.", gaps: [{ accepted: ["muss"] }] }),
  ).toBeUndefined();
  expect(
    second({
      text: "Du ___ (müssen) und er ___ kochen.",
      gaps: [{ accepted: ["musst"] }, { accepted: ["muss"] }],
    }),
  ).toContain("cue in brackets");
  // The same option twice; a mistake's sentence again.
  expect(second({ prompt: "Wo?", options: ["Im Park.", "im park."], answer: 0 }, 2)).toContain(
    "options all different",
  );
  expect(
    second({ text: "In der WG ___ (müssen) Nina heute kochen.", gaps: [{ accepted: ["muss"] }] }),
  ).toContain("never one of the mistakes again");
  expect(
    second({ prompt: "Wo ist Lena?", options: ["Im Café.", "Im Park."], answer: 0 }, 2),
  ).toContain("never one of the mistakes again");
});

test("sentences put in order: new items of a short text's sentences", () => {
  const { request } = mistakeItemsTask({
    ...input,
    groups: [
      {
        type: "order",
        what: "sentence_order",
        mistakes: [
          {
            itemKey: "k#3",
            what: "sentence_order",
            given: "Ich frühstücke.",
            right: "Ich stehe auf.",
          },
        ],
      },
    ],
  });
  expect(String(request.messages[1]?.content)).toContain(
    'new items: order, with "parts": the sentences of a short text in the right order',
  );
});

test("a mistake for the tutor: its wrong parts only, never the item whole; else its task cut at a word", () => {
  const part = {
    itemKey: "k#1",
    what: "pair" as const,
    given: "spoon",
    right: "cup",
    context: "die Tasse",
  };
  expect(wrongPartLine(part)).toBe('learner "spoon", correct "cup" for "die Tasse"');
  const exercise = {
    key: "s.x/c/01-01/ex-01",
    type: "gap_text",
    items: [
      {
        key: "s.x/c/01-01/ex-01#1",
        prompt: `${"Ein sehr langer Satz ".repeat(20)}Ende`,
        segments: ["Ich ", { gap: "g1" }, "."],
        answer: { g1: { accepted: ["muss"] } },
      },
    ],
  } as never;
  const withParts = mistakeLine({ exercise, index: 0, answer: {}, fixed: true, parts: [part] });
  expect(withParts).toBe(
    '- [item 1] (fixed later)\n  learner "spoon", correct "cup" for "die Tasse"',
  );
  const whole = mistakeLine({ exercise, index: 0, answer: { g1: "musst" }, fixed: false });
  // Cut at a word's end, never inside one.
  expect(whole.split("\n")[0]).toMatch(/Satz …$|langer …$|sehr …$|Ein …$/);
});

test("new items tried blind: asked without their keys, those answered otherwise or found ambiguous left out", () => {
  const items = [
    { prompt: "Wann ___ ich dir helfen?", options: ["soll", "sollst"], answer: 1 },
    { prompt: "Wo ist Tom?", options: ["Im Café.", "Im Park."], answer: 0 },
    { prompt: "Wer ___?", options: ["bin", "ist"], answer: 1 },
  ];
  const { name, request } = mistakeItemsCheckTask({
    language: "ru",
    target: "de",
    type: "single_choice",
    items,
  });
  expect(name).toBe("mistake_items_check");
  expect(request.effort).toBe("low");
  const asked = String(request.messages[1]?.content);
  expect(asked).toContain("1. Wann ___ ich dir helfen?\n   a) soll\n   b) sollst");
  // Never the key.
  expect(asked).not.toContain("answer");
  const right = (item: { answer?: number }, answer: unknown) =>
    "abcd"[item.answer ?? 0] === (answer as { optionId: string }).optionId;
  const kept = settledItems(
    "single_choice",
    items,
    {
      answers: [
        { n: 1, choice: "a", gaps: null, ambiguous: false },
        { n: 2, choice: "A", gaps: null, ambiguous: false },
        { n: 3, choice: "b", gaps: null, ambiguous: true },
      ],
    },
    right,
  );
  expect(kept.map((i) => i.prompt)).toEqual(["Wo ist Tom?"]);
  // Gaps typed: the words given, as the item takes them; an order is not tried.
  const typed = [{ text: "Er soll den Hund ___ (füttern).", gaps: [{ accepted: ["füttern"] }] }];
  const words: unknown[] = [];
  settledItems(
    "gap_text",
    typed,
    { answers: [{ n: 1, choice: null, gaps: ["füttern"], ambiguous: false }] },
    (_, a) => {
      words.push(a);
      return true;
    },
  );
  expect(words).toEqual([{ g1: "füttern" }]);
  const order = [{ parts: ["Ich", "trinke", "Tee."] }];
  expect(settledItems("order", order, { answers: [] }, () => false)).toEqual(order);
});
