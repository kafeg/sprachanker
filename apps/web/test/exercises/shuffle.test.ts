import { expect, test } from "bun:test";
import { optionOrder, shuffled } from "../../src/exercises/shared.tsx";

test("one exercise's items with the same options show them in one order; numbers keep theirs", () => {
  const pair = (first: string, second: string) => [
    { id: "a", text: first },
    { id: "b", text: second },
  ];
  const texts = (key: string, options: ReturnType<typeof pair>, pass = "R1") =>
    optionOrder(options, key, pass).map((o) => o.text);
  // Richtig/Falsch in either order in the source, on every item: one order throughout a pass.
  const first = texts("s/c/01-01/ex-03#1", pair("Richtig", "Falsch"));
  for (const n of [2, 3, 4, 5])
    expect(texts(`s/c/01-01/ex-03#${n}`, pair("Falsch", "Richtig"))).toEqual(first);
  // Some pass orders it the other way: it is shuffled, not fixed.
  const passes = ["R2", "R3", "R4", "R5", "R6"].map((p) =>
    texts("s/c/01-01/ex-03#1", pair("Richtig", "Falsch"), p).join(),
  );
  expect(new Set([...passes, first.join()]).size).toBe(2);
  // A sequence stays as the source gives it.
  const numbers = ["1", "2", "3", "10"].map((text, i) => ({ id: String(i), text }));
  expect(optionOrder(numbers, "s/c/01-01/ex-04#1", "R1")).toEqual(numbers);
});

const options = ["a", "b", "c", "d", "e", "f"];

test("options keep their order within a pass and are ordered anew in another", () => {
  const pass1 = shuffled(options, "R1:item#1");
  expect(shuffled(options, "R1:item#1")).toEqual(pass1);
  expect([...pass1].sort()).toEqual(options);
  // Another pass of the same item: some of several passes order it differently.
  const others = ["R2", "R3", "R4"].map((r) => shuffled(options, `${r}:item#1`).join(""));
  expect(others.some((o) => o !== pass1.join(""))).toBe(true);
});
