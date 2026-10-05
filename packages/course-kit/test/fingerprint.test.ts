import { expect, test } from "bun:test";
import { Exercise, exerciseKey, itemKey, lessonKey } from "@sprachanker/schema";
import { fingerprint, withFingerprint } from "../src/fingerprint.ts";

const key = exerciseKey(lessonKey("x.y/a1" as never, 0, 1), 1);
const draft = {
  key,
  type: "gap_text" as const,
  newWords: [],
  ruleIds: [],
  items: [
    {
      key: itemKey(key, 1),
      segments: ["Ein ", { gap: "g1" }],
      answer: { g1: { accepted: ["Tee"] } },
    },
  ],
};

test("withFingerprint produces a valid exercise whose fingerprint ignores itself", () => {
  const exercise = withFingerprint(draft);
  expect(Exercise.parse(exercise)).toEqual(exercise as never);
  expect(fingerprint(exercise)).toBe(exercise.fingerprint);
});

test("fingerprint is independent of key order and changes with content", () => {
  const reordered = { items: draft.items, ruleIds: [], newWords: [], type: draft.type, key };
  expect(fingerprint(reordered)).toBe(fingerprint(draft));
  expect(fingerprint({ ...draft, ruleIds: ["de.noun.gender" as never] })).not.toBe(
    fingerprint(draft),
  );
});
