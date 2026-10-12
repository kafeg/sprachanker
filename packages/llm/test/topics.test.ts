// The grammar topics met so far as the prompts show them: each topic
// once; with its places, all the lessons that taught it, the first first — over the budget the
// lessons' titles go before a topic or its first lesson does.
import { expect, test } from "bun:test";
import { topicPlacesLine, topicsLine } from "../src/tasks/lesson.ts";

const topics = [
  { title: "Begrüßung", lesson: "1.1", lessonTitle: "Hallo!" },
  { title: "Verb an Position 2", lesson: "1.2", lessonTitle: "Kaffee" },
  { title: "Begrüßung", lesson: "1.3", lessonTitle: "Wiedersehen" },
];

test("each topic once, the one taught again as recent as its latest lesson", () => {
  expect(topicsLine({ topics }, 500)).toBe("Grammar met so far: Verb an Position 2; Begrüßung");
});

test("with its places: every lesson that taught it, the first first; over the budget, places kept", () => {
  expect(topicPlacesLine({ topics }, 500)).toBe(
    "Grammar topics met so far, each with the lessons (unit.lesson «title») that taught it: Verb an Position 2 — 1.2 «Kaffee»; Begrüßung — 1.1 «Hallo!», 1.3 «Wiedersehen»",
  );
  expect(topicPlacesLine({ topics }, 70)).toBe(
    "Grammar topics met so far, each with the lessons (unit.lesson «title») that taught it: Verb an Position 2 — 1.2; Begrüßung — 1.1, 1.3",
  );
  // Tighter still: the oldest topic goes, never a topic's first lesson.
  expect(topicPlacesLine({ topics }, 30)).toBe(
    "Grammar topics met so far, each with the lessons (unit.lesson «title») that taught it: … Begrüßung — 1.1, 1.3",
  );
  expect(topicPlacesLine({ topics: [] }, 30)).toBeUndefined();
});
