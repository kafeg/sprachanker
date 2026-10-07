import { expect, test } from "bun:test";
import type { StoredEvent } from "@sprachanker/schema";
import { CompareView } from "../../src/notebook/compare.tsx";
import { answered, lesson, locale } from "../lesson/lesson.ts";
import { renderApp } from "../render.tsx";

const pass = (id: string, startedAt: number, events: StoredEvent[], status = "abandoned") => ({
  run: {
    id,
    kind: "lesson",
    contextKey: lesson.key,
    edition: "en-de",
    status,
    startedAt,
    result: null,
  },
  events,
  lesson,
  locale,
  explanations: [],
  writing: [],
  words: [],
  chats: [],
  scenes: [],
});

test("two passes side by side: each exercise's first try in both, then how each stands", async () => {
  const A = "01K00000000000000000000AAA";
  const B = "01K00000000000000000000BBB";
  const view = await renderApp(<CompareView ids={[A, B]} />, {
    data: [
      [["notebook", "pass", A], pass(A, 1, [answered("ex-01#1", "b")])],
      [
        ["notebook", "pass", B],
        pass(B, 2, [answered("ex-01#1", "a"), answered("ex-02#1", "a")], "active"),
      ],
    ],
  });
  const rows = (await view.findAllByRole("listitem")).map((r) => r.textContent);
  expect(rows).toEqual(["First0/11/1", "Second—1/1", "Totalnot finishedin progress"]);
});
