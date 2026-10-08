import { expect, test } from "bun:test";
import { reviewerAction } from "../../src/study/reviewer-keys.ts";

const key = (k: string, extra: Partial<{ code: string; ctrl: boolean; alt: boolean }> = {}) => ({
  key: k,
  code: extra.code ?? "",
  ctrl: extra.ctrl ?? false,
  alt: extra.alt ?? false,
});

test("Space and Enter show the answer, then answer Good", () => {
  expect(reviewerAction(key(" "), "question")).toEqual({ do: "show" });
  expect(reviewerAction(key("Enter"), "answer")).toEqual({ do: "rate", rating: 3 });
});

test("Anki's keys: ratings, replay, undo, bury, suspend, mark, flags", () => {
  expect(reviewerAction(key("1"), "answer")).toEqual({ do: "rate", rating: 1 });
  expect(reviewerAction(key("R"), "question")).toEqual({ do: "replay" });
  expect(reviewerAction(key("F5"), "question")).toEqual({ do: "replay" });
  expect(reviewerAction(key("z", { ctrl: true }), "answer")).toEqual({ do: "undo" });
  expect(reviewerAction(key("="), "answer")).toEqual({ do: "bury", note: true });
  expect(reviewerAction(key("@"), "answer")).toEqual({ do: "suspend", note: false });
  expect(reviewerAction(key("*"), "answer")).toEqual({ do: "mark" });
  expect(reviewerAction(key("3", { code: "Digit3", ctrl: true }), "answer")).toEqual({
    do: "flag",
    flag: 3,
  });
  // Ctrl or Alt with another key is not the reviewer's.
  expect(reviewerAction(key("r", { ctrl: true }), "answer")).toBeUndefined();
  expect(reviewerAction(key("x"), "answer")).toBeUndefined();
});
