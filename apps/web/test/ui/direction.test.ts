import { afterEach, expect, test } from "bun:test";
import { arrowStep, inLang } from "../../src/ui/direction.tsx";

afterEach(() => {
  document.documentElement.dir = "ltr";
});

test("arrow keys step along the reading direction: → forward, but ← right to left", () => {
  expect(["ArrowRight", "ArrowLeft", "Enter"].map(arrowStep)).toEqual([1, -1, 0]);
  document.documentElement.dir = "rtl";
  expect(["ArrowRight", "ArrowLeft", "Enter"].map(arrowStep)).toEqual([-1, 1, 0]);
});

test("text in a language carries its lang and that language's direction", () => {
  expect(inLang("de")).toEqual({ lang: "de", dir: "ltr" });
  expect(inLang("fa")).toEqual({ lang: "fa", dir: "rtl" });
  expect(inLang(undefined)).toEqual({ lang: undefined });
});
