import { expect, test } from "bun:test";
import type { Exercise } from "@sprachanker/schema";
import { ItemCard } from "../../src/exercises/item-card.tsx";
import { TargetLang } from "../../src/ui/target-lang.ts";
import { renderApp } from "../render.tsx";

const dictation = {
  key: "sprachanker.test/demo/00-01/ex-03",
  type: "dictation",
  fingerprint: "x",
  newWords: [],
  ruleIds: [],
  items: [
    {
      key: "sprachanker.test/demo/00-01/ex-03#1",
      prompt: "Hör zu",
      media: { audio: "media/audio/tag.mp3" },
      answer: { accepted: ["Guten Tag"] },
    },
  ],
} as unknown as Exercise;

const card = (outcome?: "wrong" | "correct") =>
  renderApp(
    <TargetLang value="de">
      <ItemCard
        exercise={dictation}
        locale={null}
        index={0}
        answer={{ text: "Gutten Tag" }}
        outcome={
          outcome && {
            result: outcome,
            score: outcome === "correct" ? 1 : 0,
          }
        }
        url={(p) => `/library/x/${p}`}
      />
    </TargetLang>,
  );

test("an item shows its prompt and, under a wrong answer, the right one", async () => {
  const wrong = await card("wrong");
  expect(wrong.getByText("Hör zu")).toBeTruthy();
  expect(wrong.getByText("Guten Tag")).toBeTruthy();
  expect(wrong.getByText(/Correct answer/)).toBeTruthy();
});

test("a right answer or one not checked yet shows no answer under it", async () => {
  const right = await card("correct");
  expect(right.queryByText(/Correct answer/)).toBeNull();
  right.unmount();
  const open = await card();
  expect(open.queryByText(/Correct answer/)).toBeNull();
});

test("options in the learner's language come from the locale file, without the target's lang", async () => {
  const choice = {
    key: "sprachanker.test/demo/00-01/ex-04",
    type: "single_choice",
    fingerprint: "x",
    newWords: [],
    ruleIds: [],
    items: [
      {
        key: "sprachanker.test/demo/00-01/ex-04#1",
        options: [{ id: "a" }, { id: "b", text: "Ja, gern." }],
        answer: { optionIds: ["a"] },
      },
    ],
  } as unknown as Exercise;
  const view = await renderApp(
    <TargetLang value="de">
      <ItemCard
        exercise={choice}
        locale={{
          sourceId: "x",
          items: { "#1": { prompt: "Лиза и Керстин…", options: { a: "хорошо знакомы." } } },
        }}
        index={0}
        answer={undefined}
        url={(p) => `/library/x/${p}`}
      />
    </TargetLang>,
  );
  expect(view.getByText("Лиза и Керстин…")).toBeTruthy();
  expect(view.getByText("хорошо знакомы.").getAttribute("lang")).toBeNull();
  expect(view.getByText("Ja, gern.").getAttribute("lang")).toBe("de");
});
