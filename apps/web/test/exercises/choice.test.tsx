import { expect, test } from "bun:test";
import type { Exercise, Outcome } from "@sprachanker/schema";
import { ItemCard } from "../../src/exercises/item-card.tsx";
import { keptTogether, TILE } from "../../src/exercises/shared.tsx";
import { TargetLang } from "../../src/ui/target-lang.ts";
import { renderApp } from "../render.tsx";

const choice = {
  key: "sprachanker.test/demo/00-01/ex-02",
  type: "single_choice",
  fingerprint: "x",
  newWords: [],
  ruleIds: [],
  items: [
    {
      key: "sprachanker.test/demo/00-01/ex-02#1",
      options: [
        { id: "a", text: "Sie telefonieren mit der Familie." },
        { id: "b", text: "Sie lachen." },
        { id: "c", text: "Ja." },
      ],
      answer: { optionIds: ["b"] },
    },
  ],
} as unknown as Exercise;

const card = (outcome?: Outcome) =>
  renderApp(
    <TargetLang value="de">
      <ItemCard
        exercise={choice}
        locale={null}
        index={0}
        answer={{ optionId: "a" }}
        outcome={outcome}
        url={(p) => p}
        onAnswer={() => undefined}
      />
    </TargetLang>,
  );

const layout = (view: Awaited<ReturnType<typeof card>>) =>
  view.getAllByRole("button", { pressed: false }).map((b) => b.className);

test("text options each have their row, long or short, and keep it once checked", async () => {
  const open = await card();
  const before = [...open.container.querySelectorAll("button[aria-pressed]")].map(
    (b) => b.className,
  );
  for (const c of before) expect(c).toContain("w-full");
  expect(open.container.querySelector("button[aria-pressed]")?.parentElement?.className).toBe(
    "grid gap-2",
  );
  open.unmount();
  const checked = await card({ result: "wrong", score: 0 });
  // The marks sit in the room each option keeps: no option changes size.
  const marks = [...checked.container.querySelectorAll("button[aria-pressed] svg")];
  expect(marks.length).toBe(2);
  for (const m of marks) expect(m.getAttribute("class")).toContain("absolute");
  expect(layout(checked).every((c) => c.includes("w-full pr-11"))).toBe(true);
});

test("a tile is one width whatever its text: it never grows past its share of the row", () => {
  expect(TILE).toContain("min-w-0");
});

test("an ellipsis stays with the word before it, a number with its short unit", () => {
  expect(keptTogether("wissen Sie vielleicht, ...?")).toBe("wissen Sie vielleicht, ...?");
  expect(keptTogether("Ich komme aus …")).toBe("Ich komme aus …");
  expect(keptTogether("… kommst du?")).toBe("… kommst du?");
  expect(keptTogether("2 KM weit, 10 % mehr, 3 Kinder")).toBe("2 KM weit, 10 % mehr, 3 Kinder");
});
