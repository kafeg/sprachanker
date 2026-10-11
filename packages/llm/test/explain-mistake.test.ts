import { describe, expect, test } from "bun:test";
import { fixture } from "@sprachanker/course-fixture";
import type { Exercise, LocaleExercise } from "@sprachanker/schema";
import { describeItem } from "../src/tasks/describe.ts";
import { explainMistakeMessages } from "../src/tasks/explain-mistake.ts";
import { htmlToText } from "../src/text.ts";

const lesson = fixture.lessons[0];
const locale = fixture.locales["ru-de"]?.lessons[0];
const exercise = (n: number): [Exercise, LocaleExercise | undefined] => {
  const ex = lesson?.pages[n - 1]?.exercise;
  if (!ex) throw new Error(`no exercise ${n}`);
  return [ex, locale?.exercises[ex.key]];
};

describe("describeItem", () => {
  test.each([
    [1, 0, { optionId: "b" }, '"Im Café."', '"Im Park."'],
    [
      3,
      0,
      {
        pairs: [
          ["a", "a"],
          ["b", "b"],
        ],
      },
      "die Tasse — ",
      "die Tasse — ",
    ],
    [4, 0, { sequence: ["b", "a", "c", "d"] }, "Ich trinke gern Tee.", "trinke Ich gern Tee."],
    [5, 0, { sequence: ["a", "b", "c", "c", "e"] }, "Tasse", "Tasse"],
    [6, 0, { g1: "a" }, "Guten Tag, [Frau] Weber.", "Guten Tag, [Herr] Weber."],
    [
      7,
      0,
      { g1: "b" },
      "Ich [heiße] Lena. Ich [bestelle] einen Kaffee.",
      "Ich [bestelle] Lena. Ich [___] einen Kaffee.",
    ],
  ] as const)("exercise %i item %i", (n, index, answer, correct, learner) => {
    const [ex, loc] = exercise(n);
    const d = describeItem(ex, loc, index, answer);
    expect(d.correct).toStartWith(correct);
    expect(d.learner).toStartWith(learner);
    expect(d.task.length).toBeGreaterThan(0);
  });

  test("no answer or an answer of the wrong shape is reported as none", () => {
    const [ex, loc] = exercise(1);
    expect(describeItem(ex, loc, 0, undefined).learner).toBeUndefined();
    expect(describeItem(ex, loc, 0, { text: "x" }).learner).toBeUndefined();
  });
});

describe("explainMistakeMessages", () => {
  test("system rules in English, explanation language named, data delimited", () => {
    const [ex, loc] = exercise(6);
    const [system, user] = explainMistakeMessages({
      exercise: ex,
      locale: loc,
      index: 0,
      answer: { g1: "a" },
      grammarHtml: ["<p>Frau = <b>Mrs</b></p><ul><li>Herr</li></ul>"],
      level: "A2",
      language: "ru",
      target: "de",
    });
    expect(system?.content).toContain("Explain in Russian");
    expect(system?.content).toContain("German course at the level given");
    expect(user?.content).toContain("<exercise>\nLearner's level: A2\n");
    expect(user?.content).toContain("Correct answer: Guten Tag, [Frau] Weber.");
    expect(user?.content).toContain("Learner's answer: Guten Tag, [Herr] Weber.");
    expect(user?.content).toContain("<lesson_notes>\nFrau = Mrs\n\n- Herr\n</lesson_notes>");
  });

  test("what is wrong, never why it was chosen; tendencies no rules; where its topic was taught", () => {
    const [ex, loc] = exercise(6);
    const [system, user] = explainMistakeMessages({
      exercise: ex,
      locale: loc,
      index: 0,
      answer: { g1: "a" },
      grammarHtml: ["<p>Frau = <b>Mrs</b></p>"],
      topics: [
        { title: "Begrüßung", lesson: "0.1", lessonTitle: "Hallo!" },
        { title: "Herr und Frau", lesson: "0.2" },
      ],
      language: "ru",
      target: "de",
    });
    expect(system?.content).toContain("never guess why they chose it");
    expect(system?.content).toContain('a tendency ("usually", "often") is no rule');
    expect(system?.content).toContain("This is X from lesson 1.2 «title»");
    expect(system?.content).toContain("Write only in Russian and German");
    expect(user?.content).toContain(
      "<lesson_notes>\nGrammar topics met so far, each with the lesson that taught it: Begrüßung — lesson 0.1 «Hallo!»; Herr und Frau — lesson 0.2\nFrau = Mrs\n</lesson_notes>",
    );
  });
});

test("htmlToText", () => {
  expect(htmlToText("<p>a&nbsp;&amp;&#252;</p><table><tr><td>x</td><td>y</td></tr></table>")).toBe(
    "a &ü\nx | y |",
  );
});

test("htmlToText keeps a numeric entity past Unicode as written", () => {
  expect(htmlToText("a&#99999999;b&#x110000;c")).toBe("a&#99999999;b&#x110000;c");
});
