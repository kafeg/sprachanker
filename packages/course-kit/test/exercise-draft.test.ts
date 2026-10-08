import { expect, test } from "bun:test";
import type { ExerciseKey } from "@sprachanker/schema";
import {
  draftExercise,
  fingerprint,
  splitAtCyrillic,
  Unmapped,
  unknownExercise,
} from "../src/index.ts";

const key = "s.x/c/00-01/ex-01" as ExerciseKey;

test("a draft that fits its type becomes the exercise, fingerprinted as drafted", () => {
  const exercise = draftExercise({
    key,
    type: "single_choice",
    items: [
      {
        key: `${key}#1`,
        options: [
          { id: "a", text: "Ja" },
          { id: "b", text: "Nein" },
        ],
        answer: { optionIds: ["a"] },
      },
    ],
  });
  expect(exercise.newWords).toEqual([]);
  expect(exercise.fingerprint).toBe(fingerprint(exercise));
});

test("one that does not fit is the mapping's mistake, reported as unmapped; unknown keeps the reason", () => {
  expect(() => draftExercise({ key, type: "single_choice", items: [{ key: `${key}#1` }] })).toThrow(
    Unmapped,
  );
  const unknown = unknownExercise({ key }, "raw/e-1.json", "an unseen mechanic");
  expect(unknown.type).toBe("unknown");
  expect(unknown.items[0]).toMatchObject({ raw: "raw/e-1.json", reason: "an unseen mechanic" });
});

test("a line split where the Russian starts after English", () => {
  expect(splitAtCyrillic("baseball бейсбол")).toEqual(["baseball", "бейсбол"]);
  expect(splitAtCyrillic("бейсбол")).toEqual(["бейсбол"]);
  expect(splitAtCyrillic("baseball")).toEqual(["baseball"]);
});
