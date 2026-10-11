import { expect, test } from "bun:test";
import type { Exercise, Outcome } from "@sprachanker/schema";
import { gapWidth } from "../../src/exercises/gaps.tsx";
import { ItemCard } from "../../src/exercises/item-card.tsx";
import { TargetLang } from "../../src/ui/target-lang.ts";
import { renderApp } from "../render.tsx";

/** Text as it is, its no-break spaces kept. */
const RAW = { normalizer: (s: string) => s };

const exercise = (type: "gap_text" | "gap_choice", item: Record<string, unknown>) =>
  ({
    key: "sprachanker.test/demo/00-01/ex-05",
    type,
    fingerprint: "x",
    newWords: [],
    ruleIds: [],
    items: [{ key: "sprachanker.test/demo/00-01/ex-05#1", ...item }],
  }) as unknown as Exercise;

const card = (ex: Exercise, answer: unknown, outcome?: Outcome) =>
  renderApp(
    <TargetLang value="de">
      <ItemCard
        exercise={ex}
        locale={null}
        index={0}
        answer={answer}
        outcome={outcome}
        url={(p) => p}
        onAnswer={() => undefined}
      />
    </TargetLang>,
  );

test("a typed gap has room for its longest answer, rounded up, and grows with what is typed", () => {
  expect(gapWidth(["Touristeninformation"])).toBe(24);
  expect(gapWidth(["Milch", "Zucker"])).toBe(8);
  expect(gapWidth(["ja"])).toBe(6);
  expect(gapWidth(["ja"], "Ich weiß es nicht")).toBe(19);
});

const typed = exercise("gap_text", {
  segments: ["Das ist ", { gap: "g1" }, ". Er wohnt hier."],
  answer: { g1: { accepted: ["die Touristeninformation"] } },
});

test("a checked typed gap shows the answer given as text, the right one and the full stop with it", async () => {
  const view = await card(typed, { g1: "das Hotel" }, {
    result: "wrong",
    score: 0,
    parts: { g1: false },
  } as Outcome);
  expect(view.queryByRole("textbox")).toBeNull();
  expect(view.getByText("das Hotel")).toBeTruthy();
  // The right answer and the full stop after the gap in one run: no line starts with ".".
  const right = view.getByText("→\u00a0die Touristeninformation", RAW);
  expect(right.parentElement?.textContent).toBe("→\u00a0die Touristeninformation.");
  expect(view.getByText(/Er wohnt hier/).textContent).toBe(" Er wohnt hier.");
});

test("an open typed gap is a field as wide as its answer needs", async () => {
  const view = await card(typed, {});
  const field = view.getByRole("textbox", { name: "Gap 1" }) as HTMLInputElement;
  expect(field.style.width).toBe("calc(28ch + 1.25rem)");
});

test("a checked drop-down gap shows the choice as text with its mark, no greyed list", async () => {
  const chosen = exercise("gap_choice", {
    segments: ["Guten Tag, ", { gap: "g1" }, " Weber."],
    gaps: {
      g1: {
        options: [
          { id: "a", text: "Herr" },
          { id: "b", text: "Frau" },
        ],
      },
    },
    display: "dropdown",
    answer: { g1: "b" },
  });
  const view = await card(chosen, { g1: "a" }, {
    result: "wrong",
    score: 0,
    parts: { g1: false },
  } as Outcome);
  expect(view.queryByRole("combobox")).toBeNull();
  expect(view.getByText("Herr")).toBeTruthy();
  expect(view.getByText("→\u00a0Frau", RAW)).toBeTruthy();
});
