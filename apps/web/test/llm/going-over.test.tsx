// Going over mistakes (09): no review yet — what the step is and the way to start; a review — one type
// at a time ("Type 1 of 2"): its wrong parts only, the explanation, the new items; the next type once
// they are answered; all answered, the score; earlier reviews listed.
import { expect, test } from "bun:test";
import type { MistakesReview } from "@sprachanker/schema";
import { fireEvent } from "@testing-library/react";
import type { Review } from "../../src/llm/api.ts";
import { GoingOverStep } from "../../src/llm/going-over.tsx";
import { TargetLang } from "../../src/ui/target-lang.ts";
import { lesson } from "../lesson/lesson.ts";
import { renderApp } from "../render.tsx";

const ids = { series: "sprachanker.test", lessonKey: lesson.key, edition: "en-de" };
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

const review = (answers: Review["answers"] = [], id = "01K7A0Z8ZQ4J1V2W3X4Y5Z6A70"): Review => ({
  task: "mistakes",
  input: "",
  result: REVIEW,
  model: "lab/test-model",
  latencyMs: 10,
  id,
  runId: "01K7A0Z8ZQ4J1V2W3X4Y5Z6A71",
  itemKey: null,
  cardId: null,
  ts: 1_790_000_000_000,
  answers,
});

const step = (reviews: Review[], preparing = false) =>
  renderApp(
    <TargetLang value="de">
      <GoingOverStep {...ids} />
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

test("all answered: the score; earlier reviews listed with theirs", async () => {
  const all = [given(0, "correct"), given(1, "wrong"), given(2, "correct")];
  const earlier = review([given(2, "wrong")], "01K7A0Z8ZQ4J1V2W3X4Y5Z6A72");
  const view = await step([review(all), earlier]);
  expect(view.getByText("2 of 3 right")).toBeTruthy();
  expect(view.getByText("Mistakes gone over earlier in this lesson")).toBeTruthy();
  expect(view.getByText(/0 of 3 right/)).toBeTruthy();
  expect(view.getByRole("button", { name: "Go over again" })).toBeTruthy();
  view.unmount();
});
