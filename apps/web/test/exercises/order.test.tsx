import { expect, test } from "bun:test";
import { type Exercise, partsAreSentences } from "@sprachanker/schema";
import { ItemCard } from "../../src/exercises/item-card.tsx";
import { TargetLang } from "../../src/ui/target-lang.ts";
import { renderApp } from "../render.tsx";

const order = (parts: string[]) =>
  ({
    key: "sprachanker.test/demo/00-01/ex-06",
    type: "order",
    fingerprint: "x",
    newWords: [],
    ruleIds: [],
    items: [
      {
        key: "sprachanker.test/demo/00-01/ex-06#1",
        join: "space",
        parts: parts.map((text, i) => ({ id: String.fromCharCode(97 + i), text })),
        answer: { sequence: parts.map((_, i) => String.fromCharCode(97 + i)) },
      },
    ],
  }) as unknown as Exercise;

const checked = (ex: Exercise, sequence: string[], right: boolean) =>
  renderApp(
    <TargetLang value="de">
      <ItemCard
        exercise={ex}
        locale={null}
        index={0}
        answer={{ sequence }}
        outcome={{ result: right ? "correct" : "wrong", score: right ? 1 : 0 }}
        url={(p) => p}
        onAnswer={() => undefined}
      />
    </TargetLang>,
  );

test("parts that are sentences, not one sentence's words or clauses", () => {
  expect(partsAreSentences(["Nico kommt an.", "Er sucht ein Zimmer."])).toBe(true);
  expect(partsAreSentences(["Paul", "ist", "müde", "."])).toBe(false);
  expect(partsAreSentences(["Paul ist zwar müde.", ",", "aber er geht zur Party"])).toBe(false);
});

test("sentences in a wrong order: a numbered list, each marked in place or not; the right one numbered", async () => {
  const ex = order(["Nico kommt an.", "Er sucht ein Zimmer.", "Er findet eins."]);
  const view = await checked(ex, ["b", "a", "c"], false);
  const items = view.getAllByRole("listitem").map((li) => li.textContent);
  expect(items).toEqual(["1.Er sucht ein Zimmer.", "2.Nico kommt an.", "3.Er findet eins."]);
  expect(view.getAllByLabelText("not in its place")).toHaveLength(2);
  expect(view.getAllByLabelText("in its place")).toHaveLength(1);
  expect(view.getByText(/1\. Nico kommt an\.\s+2\. Er sucht ein Zimmer\./)).toBeTruthy();
});

test("a sentence's words in a wrong order stay chips, each marked; right, they read as the sentence", async () => {
  const ex = order(["Ich", "bin", "müde", "."]);
  const wrong = await checked(ex, ["b", "a", "c", "d"], false);
  expect(wrong.getByRole("button", { name: "bin" }).className).toContain("border-wrong");
  expect(wrong.getByRole("button", { name: "müde" }).className).toContain("border-correct");
  wrong.unmount();
  const right = await checked(ex, ["a", "b", "c", "d"], true);
  expect(right.getByText("Ich bin müde.")).toBeTruthy();
});
