import { expect, test } from "bun:test";
import { parseSteps } from "../../src/study/review-settings.tsx";

test("steps typed as Anki writes them: minutes, hours, days; anything else does not read", () => {
  expect(parseSteps("1m 10m")).toEqual(["1m", "10m"]);
  expect(parseSteps("5m, 1h, 1d")).toEqual(["5m", "1h", "1d"]);
  expect(parseSteps("10 minutes")).toBeUndefined();
  expect(parseSteps("")).toBeUndefined();
  expect(parseSteps("", true)).toEqual([]);
});
