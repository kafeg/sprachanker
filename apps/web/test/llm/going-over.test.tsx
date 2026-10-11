// Going over mistakes (09): no review of the run yet — what the step is and the way to start; a review
// — one type at a time ("Type 1 of 2"): its wrong parts only, the explanation, the new items; the next
// type once they are answered; all answered, the score and the step done; the lesson's other reviews
// listed; a type listed only; nothing to go over: the step skipped.
import { expect, mock, test } from "bun:test";
import type { MistakesReview } from "@sprachanker/schema";
import { fireEvent } from "@testing-library/react";
import { ApiError } from "../../src/api/client.ts";
import type { Review } from "../../src/llm/api.ts";
import * as api from "../../src/llm/api.ts";
import { TargetLang } from "../../src/ui/target-lang.ts";
import { lesson } from "../lesson/lesson.ts";
import { renderApp } from "../render.tsx";

// Starting a review answers as the server would, never asking the network: refused while set.
let refused: unknown;
mock.module("../../src/llm/api.ts", () => ({
  ...api,
  useStartGoingOver: () => ({ isPending: false, error: refused, mutate: () => {} }),
}));
const { GoingOverStep } = await import("../../src/llm/going-over.tsx");

const ids = { series: "sprachanker.test", lessonKey: lesson.key, edition: "en-de" };
const RUN = "01K7A0Z8ZQ4J1V2W3X4Y5Z6A71";
const llm: [unknown[], unknown] = [["llm"], { provider: "custom", model: "test-model" }];

const REVIEW: MistakesReview = {
  groups: [
    {
      type: "gap_text",
      what: "ending",
      mistakes: [
        {
          itemKey: "k#1",
          what: "ending",
          given: "musst",
          right: "muss",
          context: "In der WG [_] Nina heute kochen.",
        },
      ],
      explanation: "With **ich** and **er/sie**: muss.",
      items: [
        { text: "Er ___ heute arbeiten.", gaps: [{ accepted: ["muss"] }] },
        { text: "Du ___ heute arbeiten.", gaps: [{ accepted: ["musst"] }] },
      ],
    },
    {
      type: "single_choice",
      what: "choice",
      mistakes: [{ itemKey: "k#2", what: "choice", given: "Im Park.", right: "Im Café." }],
      explanation: "Read the question again.",
      items: [{ prompt: "Wo ist Tom?", options: ["Im Café.", "Im Park."], answer: 0 }],
    },
  ],
};

const given = (question: number, result: "correct" | "wrong") => ({
  verdict: "01K7A0Z8ZQ4J1V2W3X4Y5Z6A70",
  question,
  answer: question < 2 ? { g1: "muss" } : { optionId: "a" },
  outcome: { result, score: result === "correct" ? 1 : 0 },
  ts: 2,
});

const review = (
  answers: Review["answers"] = [],
  id = "01K7A0Z8ZQ4J1V2W3X4Y5Z6A70",
  runId = RUN,
  result = REVIEW,
): Review => ({
  task: "mistakes",
  input: "",
  result,
  model: "lab/test-model",
  latencyMs: 10,
  id,
  runId,
  itemKey: null,
  cardId: null,
  ts: 1_790_000_000_000,
  answers,
});

const step = (
  reviews: Review[],
  preparing = false,
  on: { onDone?(): void; onNothing?(): void; runId?: string } = {},
) =>
  renderApp(
    <TargetLang value="de">
      <GoingOverStep {...ids} runId={RUN} {...on} />
    </TargetLang>,
    { data: [llm, [["going-over", ids.lessonKey], { reviews, preparing }]] },
  );

test("no review yet: what the step is and the way to start; one being written keeps it waiting", async () => {
  const none = await step([]);
  expect(none.getByText(/Your mistakes in this pass, by type/)).toBeTruthy();
  expect(none.getByRole("button", { name: "Go over my mistakes" })).toBeTruthy();
  none.unmount();
  const waiting = await step([], true);
  expect(
    waiting.getByRole("button", { name: /Going over your mistakes…/ }).hasAttribute("disabled"),
  ).toBe(true);
  waiting.unmount();
});

test("one type at a time: the wrong parts only, the explanation, the new items; the next type once they are answered", async () => {
  const view = await step([review()]);
  expect(view.getByText(/Type 1 of 2/)).toBeTruthy();
  expect(view.getByRole("heading", { name: "Endings" })).toBeTruthy();
  expect(view.getByText("musst")).toBeTruthy();
  expect(view.getByText("In der WG [_] Nina heute kochen.")).toBeTruthy();
  expect(view.getByText(/With/)).toBeTruthy();
  // Its two new items, each answered by "Check"; the next type not yet.
  expect(view.getAllByRole("button", { name: "Check" })).toHaveLength(2);
  expect(view.getByRole("button", { name: /Next type/ }).hasAttribute("disabled")).toBe(true);
  expect(view.queryByText("Read the question again.")).toBeNull();
  view.unmount();

  // Opened again with the first type answered: on the second, the first still there to read.
  const answered = await step([review([given(0, "correct"), given(1, "wrong")])]);
  expect(answered.getByText(/Type 2 of 2/)).toBeTruthy();
  expect(answered.getByRole("heading", { name: "Choices" })).toBeTruthy();
  expect(answered.getByText("Read the question again.")).toBeTruthy();
  fireEvent.click(answered.getByRole("button", { name: /Previous type/ }));
  expect(answered.getByText(/Type 1 of 2/)).toBeTruthy();
  expect(answered.getAllByRole("status").map((s) => s.textContent)).toEqual([
    "Correct",
    "Not quite",
  ]);
  const next = answered.getByRole("button", { name: /Next type/ });
  expect(next.hasAttribute("disabled")).toBe(false);
  fireEvent.click(next);
  expect(answered.getByText(/Type 2 of 2/)).toBeTruthy();
  answered.unmount();
});

test("all answered: the score, the step done (also when read again after a reply lost); earlier reviews listed with theirs", async () => {
  const all = [given(0, "correct"), given(1, "wrong"), given(2, "correct")];
  const earlier = review([given(2, "wrong")], "01K7A0Z8ZQ4J1V2W3X4Y5Z6A72");
  let done = 0;
  const view = await step([review(all), earlier], false, { onDone: () => done++ });
  expect(view.getByText("2 of 3 right")).toBeTruthy();
  expect(view.getByText("Mistakes gone over earlier in this lesson")).toBeTruthy();
  expect(view.getByText(/0 of 3 right/)).toBeTruthy();
  expect(view.getByRole("button", { name: "Go over again" })).toBeTruthy();
  expect(done).toBe(1);
  view.unmount();
  // Not all answered: not done.
  const open = await step([review([given(0, "correct")])], false, { onDone: () => done++ });
  expect(done).toBe(1);
  open.unmount();
});

test("the review shown is the run's: a newer one of another run is listed as past, the run itself starts", async () => {
  const OLD = "01K7A0Z8ZQ4J1V2W3X4Y5Z6A73";
  const NEW = "01K7A0Z8ZQ4J1V2W3X4Y5Z6A74";
  const all = [given(0, "correct"), given(1, "correct"), given(2, "correct")];
  // Newest first: the earlier run's review newer than this run's own.
  const reviews = [
    review(all, "01K7A0Z8ZQ4J1V2W3X4Y5Z6A75", OLD),
    review([], "01K7A0Z8ZQ4J1V2W3X4Y5Z6A76", NEW),
  ];
  let done = 0;
  const ofNew = await step(reviews, false, { runId: NEW, onDone: () => done++ });
  expect(ofNew.getByText(/Type 1 of 2/)).toBeTruthy();
  expect(ofNew.getAllByRole("button", { name: "Check" })).toHaveLength(2);
  expect(ofNew.getByText(/3 of 3 right/)).toBeTruthy();
  expect(done).toBe(0);
  ofNew.unmount();
  // A run with none of its own: the start, the others listed.
  const fresh = await step(reviews, false, { runId: "01K7A0Z8ZQ4J1V2W3X4Y5Z6A77" });
  expect(fresh.getByRole("button", { name: "Go over my mistakes" })).toBeTruthy();
  expect(fresh.getByText("Mistakes gone over earlier in this lesson")).toBeTruthy();
  fresh.unmount();
});

test("a type listed only: its mistakes with the line of the text, what to do instead, no items; the mistakes left out counted", async () => {
  const listed: MistakesReview = {
    groups: [
      {
        what: "misread",
        mistakes: [
          {
            itemKey: "t#1",
            what: "misread",
            given: "2 Euro",
            right: "2,50 Euro",
            context: "Was kostet der Kaffee?",
            line: "Kaffee 2,50 Euro",
          },
        ],
        explanation: "",
        items: [],
      },
    ],
    more: 4,
  };
  let done = 0;
  const view = await step([review([], undefined, RUN, listed)], false, { onDone: () => done++ });
  expect(view.getByRole("heading", { name: "Misread" })).toBeTruthy();
  expect(view.getByText("Kaffee 2,50 Euro")).toBeTruthy();
  expect(view.getByText("Read the text again: the answer is in it.")).toBeTruthy();
  expect(view.queryByText("Now you")).toBeNull();
  expect(view.getByText("4 more mistakes of this pass not gone over here.")).toBeTruthy();
  // Nothing to answer: done at once.
  expect(done).toBe(1);
  view.unmount();
});

test("nothing to go over in the run: the step skips itself", async () => {
  refused = new ApiError("no_mistakes", 409);
  let nothing = 0;
  const view = await step([], false, { onNothing: () => nothing++ });
  expect(nothing).toBe(1);
  view.unmount();
  refused = undefined;
});
