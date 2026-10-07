import { expect, test } from "bun:test";
import { shuffled } from "../../src/exercises/shared.tsx";

const options = ["a", "b", "c", "d", "e", "f"];

test("options keep their order within a pass and are ordered anew in another", () => {
  const pass1 = shuffled(options, "R1:item#1");
  expect(shuffled(options, "R1:item#1")).toEqual(pass1);
  expect([...pass1].sort()).toEqual(options);
  // Another pass of the same item: some of several passes order it differently.
  const others = ["R2", "R3", "R4"].map((r) => shuffled(options, `${r}:item#1`).join(""));
  expect(others.some((o) => o !== pass1.join(""))).toBe(true);
});
