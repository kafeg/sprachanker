import { expect, test } from "bun:test";
import { prepend, withAttempt, withScene, withText, withTurns } from "../src/api/cache.ts";

test("a new item goes on top, replacing an older copy of it", () => {
  const same = (a: { id: number }, b: { id: number }) => a.id === b.id;
  expect(prepend([{ id: 1 }, { id: 2 }], { id: 2 }, same)).toEqual([{ id: 2 }, { id: 1 }]);
  expect(prepend(undefined, { id: 3 }, same)).toEqual([{ id: 3 }]);
});

test("a writing check on top of the earlier ones; nothing cached, nothing made up", () => {
  const state = { topic: ["x"], attempts: [{ ts: 1 }] };
  expect(withAttempt(state, { ts: 2 })).toEqual({ topic: ["x"], attempts: [{ ts: 2 }, { ts: 1 }] });
  expect(withAttempt(undefined, { ts: 2 })).toBeUndefined();
});

test("a scene: a started one ends the open one; a line updates it in place", () => {
  const open = { id: "a", done: false };
  expect(withScene({ scenes: [open] }, { id: "b", done: false }, true).scenes).toEqual([
    { id: "b", done: false },
    { id: "a", done: true },
  ]);
  expect(withScene({ scenes: [open] }, { id: "a", done: true }, false).scenes).toEqual([
    { id: "a", done: true },
  ]);
});

test("a chat's stored pair is added at its end, the rest of the chat kept", () => {
  expect(withTurns({ edition: "ru-de", turns: ["q1", "a1"] }, ["q2", "a2"])).toEqual({
    edition: "ru-de",
    turns: ["q1", "a1", "q2", "a2"],
  });
  expect(withTurns(undefined, ["q"])).toEqual({ turns: ["q"] });
});

test("an Understanding text: one just written on top, one answered in its place; nothing cached, nothing made up", () => {
  const state = {
    texts: [
      { id: "b", n: 1 },
      { id: "a", n: 1 },
    ],
    preparing: false,
  };
  expect(withText(state, { id: "c", n: 0 })?.texts.map((t) => t.id)).toEqual(["c", "b", "a"]);
  expect(withText(state, { id: "a", n: 2 })).toEqual({
    texts: [
      { id: "b", n: 1 },
      { id: "a", n: 2 },
    ],
    preparing: false,
  });
  expect(withText(undefined, { id: "a", n: 2 })).toBeUndefined();
});
