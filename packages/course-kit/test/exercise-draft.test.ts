import { expect, test } from "bun:test";
import type { ExerciseKey } from "@sprachanker/schema";
import {
  draftExercise,
  draftOrUnknown,
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

test("mapped and drafted, or unknown where the mapping gives up or what it made does not fit", () => {
  const raw = "raw/e-1.json";
  const items = [{ key: `${key}#1`, prompt: "Sag es", media: { audio: "media/audio/a.mp3" } }];
  const drafted = draftOrUnknown({ key }, raw, () => ({ type: "speech_selfrate", items }));
  expect([drafted.exercise.type, drafted.unmapped]).toEqual(["speech_selfrate", undefined]);
  const given = draftOrUnknown({ key }, raw, () => {
    throw new Unmapped("quiz pages not available");
  });
  expect([given.exercise.type, given.unmapped]).toEqual(["unknown", "quiz pages not available"]);
  expect(given.exercise.items[0]).toMatchObject({ raw, reason: "quiz pages not available" });
  const unfit = draftOrUnknown({ key }, raw, () => ({ type: "single_choice", items: [{}] }));
  expect(unfit.exercise.type).toBe("unknown");
  expect(unfit.unmapped).toStartWith("single_choice does not fit");
  // Anything else is a fault of the normaliser, not of the source.
  expect(() =>
    draftOrUnknown({ key }, raw, () => {
      throw new TypeError("bug");
    }),
  ).toThrow(TypeError);
});

test("a line split where the Russian starts after English", () => {
  expect(splitAtCyrillic("baseball бейсбол")).toEqual(["baseball", "бейсбол"]);
  expect(splitAtCyrillic("бейсбол")).toEqual(["бейсбол"]);
  expect(splitAtCyrillic("baseball")).toEqual(["baseball"]);
});
