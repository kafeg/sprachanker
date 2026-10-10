import { expect, test } from "bun:test";
import { StudyCard } from "../../src/study/card.tsx";
import { TargetLang } from "../../src/ui/target-lang.ts";
import { renderApp } from "../render.tsx";

const display = { target: "auch", translation: "also", series: "x", lessonKey: "x/c/00-01" };

test("a card says which way it asks: card 1 the meaning, card 2 the word in the language learnt", async () => {
  const card = (face: "recognition" | "production") =>
    renderApp(
      <TargetLang value="de">
        <StudyCard display={display} face={face} side="question" />
      </TargetLang>,
    );
  expect((await card("recognition")).getByText("What does it mean?")).toBeTruthy();
  const second = await card("production");
  expect(second.getByText("In German?")).toBeTruthy();
  expect(second.getByText("also")).toBeTruthy();
});

test("a listening card: the question is heard, not read; the answer shows the word once and its meaning", async () => {
  const card = (side: "question" | "answer") =>
    renderApp(
      <TargetLang value="de">
        <StudyCard display={display} face="listening" side={side} />
      </TargetLang>,
      // The answer links to its lesson.
      { path: "/review" },
    );
  expect((await card("question")).queryByText("auch")).toBeNull();
  const answer = await card("answer");
  expect(answer.getAllByText("auch")).toHaveLength(1);
  expect(answer.getByText("also")).toBeTruthy();
});
