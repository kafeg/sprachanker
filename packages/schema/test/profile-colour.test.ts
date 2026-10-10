import { expect, test } from "bun:test";
import { nextProfileColour } from "../src/settings.ts";

test("a new profile's colour: the first unused, a freed one first, then round again", () => {
  expect(nextProfileColour([])).toBe("amber");
  expect(nextProfileColour(["amber", "teal"])).toBe("rose");
  expect(nextProfileColour(["amber", "rose"])).toBe("teal");
  const all = ["amber", "teal", "rose", "violet", "sky", "lime"] as const;
  expect(nextProfileColour(all)).toBe("amber");
  expect(nextProfileColour([...all, "amber"])).toBe("teal");
});
